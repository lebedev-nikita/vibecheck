import { Context, Effect, Layer, Option, Ref, Schema, Stream } from "effect";
import { Chat, LanguageModel, Prompt, type Response } from "effect/ai";
import { type Connection, type ModelInfo, providerName } from "../../domain/Connection.ts";
import type { RestyleResult } from "../../domain/Restyle.ts";
import { ChatGPTAuth } from "../chatgpt/ChatGPTAuth.ts";
import { Pages } from "../Pages.ts";
import { parseModelOutput, systemPrompt } from "../prompt.ts";
import { fromAiError, isInvalidRequest, ProviderError } from "../providers/ProviderError.ts";
import { languageModelFor, listModelsFor } from "./models.ts";
import { MAX_PREVIEWS, RestyleTools } from "./tools.ts";

/** Model turns per Restyle Request, tool calls included. */
const MAX_STEPS = 8;

interface RestyleJob {
  readonly connection: Connection;
  readonly tabId: number;
  readonly scriptsEnabled: boolean;
  /** The user message: the request, the Page Snapshot and the current Site Style. */
  readonly text: string;
  /** Base64 JPEGs sent with it: the screenshot, then the Reference Images. */
  readonly images: ReadonlyArray<string>;
  /** Reports what the agent is doing, for the popup. */
  readonly onActivity: (activity: string) => Effect.Effect<void>;
}

/** The server rejected the first request with tools; it gets one without them. */
class ToolsUnsupported extends Schema.TaggedError<ToolsUnsupported>()("ToolsUnsupported", {}) {}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const userMessage = (images: ReadonlyArray<string>, text: string): Prompt.MessageEncoded => ({
  role: "user",
  content: [
    ...images.map((data) => ({
      type: "file" as const,
      mediaType: "image/jpeg",
      data: bytes(data),
    })),
    { type: "text" as const, text },
  ],
});

const textOf = (parts: Iterable<Response.AnyPart>) =>
  Array.from(parts, (part) => (part.type === "text-delta" ? part.delta : "")).join("");

/** One request without tools; the model answers with the Site Style as JSON. */
const answerOnce = (job: RestyleJob, model: Layer.Layer<LanguageModel.LanguageModel>) =>
  LanguageModel.streamText({
    prompt: Prompt.make([
      {
        role: "system",
        content: systemPrompt({ scriptsEnabled: job.scriptsEnabled, tools: false }),
      },
      userMessage(job.images, job.text),
    ]),
  }).pipe(
    Stream.runCollect,
    Effect.flatMap((parts) => parseModelOutput(textOf(parts))),
    Effect.provide(model),
  );

export class Agent extends Context.Service<
  Agent,
  {
    readonly restyle: (job: RestyleJob) => Effect.Effect<RestyleResult, ProviderError>;
    readonly listModels: (
      connection: Connection,
    ) => Effect.Effect<ReadonlyArray<ModelInfo>, ProviderError>;
  }
>()("vibecheck/background/agent/Agent") {
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const pages = yield* Pages;
      const chatGPT = yield* ChatGPTAuth;

      /** Lets the model inspect and preview until it submits a Site Style. */
      const work = Effect.fnUntraced(
        function* (job: RestyleJob, model: Layer.Layer<LanguageModel.LanguageModel>) {
          const submitted = yield* Ref.make(Option.none<RestyleResult>());
          const screenshots: Array<string> = [];
          let previews = 0;

          const toolkit = yield* RestyleTools.pipe(
            Effect.provide(
              RestyleTools.toLayer({
                inspect: ({ selector }) =>
                  job.onActivity(`Inspecting ${selector}`).pipe(
                    Effect.andThen(pages.inspect(job.tabId, selector)),
                    Effect.mapError((error) => error.message),
                  ),
                preview: ({ css, scroll_to }) =>
                  Effect.gen(function* () {
                    if (previews >= MAX_PREVIEWS) {
                      return yield* Effect.fail("No previews left. Submit the Site Style now.");
                    }
                    previews += 1;
                    yield* job.onActivity(`Previewing draft ${previews}`);
                    const { found } = yield* pages
                      .preview(job.tabId, css, scroll_to)
                      .pipe(Effect.mapError((error) => error.message));
                    const shot = yield* pages.screenshot(job.tabId).pipe(Effect.option);
                    if (shot._tag === "Some") screenshots.push(shot.value);
                    return [
                      found
                        ? ""
                        : `No element matches "${scroll_to}", so the page was not scrolled.`,
                      shot._tag === "Some"
                        ? "The draft is applied; its screenshot follows in the next message."
                        : "The draft is applied, but no screenshot could be taken because the tab is not in front.",
                    ]
                      .filter(Boolean)
                      .join(" ");
                  }),
                submit_site_style: (result) =>
                  Ref.set(submitted, Option.some(result)).pipe(Effect.as("Submitted.")),
              }),
            ),
          );

          const session = yield* Chat.fromPrompt(
            Prompt.make([
              {
                role: "system",
                content: systemPrompt({ scriptsEnabled: job.scriptsEnabled, tools: true }),
              },
              userMessage(job.images, job.text),
            ]),
          );
          const append = (message: Prompt.MessageEncoded) =>
            Ref.update(session.history, (history) =>
              Prompt.concat(history, Prompt.make([message])),
            );

          for (let step = 0; step < MAX_STEPS; step++) {
            if (step === MAX_STEPS - 1) {
              yield* append({
                role: "user",
                content:
                  "This is the last step. Call submit_site_style now with the complete Site Style.",
              });
            }
            yield* job.onActivity(step === 0 ? "Designing" : "Refining");
            const parts = yield* session.streamText({ prompt: [], toolkit }).pipe(
              Stream.runCollect,
              Effect.provide(model),
              Effect.mapError((error) =>
                step === 0 && isInvalidRequest(error) ? new ToolsUnsupported() : error,
              ),
            );

            const result = yield* Ref.get(submitted);
            if (result._tag === "Some") return result.value;
            // Chat Completions tool results are text only, so screenshots follow as a user turn.
            if (screenshots.length > 0) {
              yield* append(userMessage(screenshots.splice(0), "Screenshot of the preview."));
            }
            if (!Array.from(parts).some((part) => part.type === "tool-call")) {
              // Some models answer in text despite the tools; accept a Site Style written out.
              const written = yield* parseModelOutput(textOf(parts)).pipe(Effect.option);
              if (written._tag === "Some") return written.value;
              yield* append({
                role: "user",
                content: "Call submit_site_style with the complete Site Style to finish.",
              });
            }
          }
          return yield* new ProviderError({
            message: "The model did not finish in time. Try again or make the request simpler.",
          });
        },
        (effect, job) => Effect.ensuring(effect, pages.clearPreview(job.tabId)),
      );

      const restyle = Effect.fn("Agent.restyle")(function* (job: RestyleJob) {
        const { connection } = job;
        const token = connection._tag === "chatgpt" ? yield* chatGPT.accessToken(connection) : null;
        const model = languageModelFor(connection, token);
        return yield* work(job, model).pipe(
          Effect.catchTag("ToolsUnsupported", () =>
            job.onActivity("Retrying without tools").pipe(Effect.andThen(answerOnce(job, model))),
          ),
          Effect.catchTags({
            AiError: (error) => Effect.fail(fromAiError(providerName(connection._tag))(error)),
            InvalidModelOutput: (error) =>
              Effect.fail(new ProviderError({ message: error.message })),
          }),
        );
      });

      const listModels = (connection: Connection) =>
        connection._tag === "chatgpt" ? chatGPT.listModels(connection) : listModelsFor(connection);

      return Agent.of({ restyle, listModels });
    }),
  );
}
