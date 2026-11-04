import { Context, Effect, Fiber, Layer, Schema } from "effect";
import { acceptsImages } from "../domain/Connection.ts";
import type { ReferenceImage, RestyleStatus } from "../domain/Restyle.ts";
import {
  appendRevision,
  emptySiteStyle,
  restylableOrigin,
  type Revision,
} from "../domain/SiteStyle.ts";
import * as Storage from "../shared/storage.ts";
import { Pages } from "./Pages.ts";
import { Agent } from "./agent/Agent.ts";
import { userPrompt } from "./prompt.ts";
import { effectiveFor, Registrations, userScriptsAvailable } from "./Registrations.ts";

class RestyleError extends Schema.TaggedError<RestyleError>()("RestyleError", {
  message: Schema.String,
}) {}

interface RestyleInput {
  readonly tabId: number;
  readonly prompt: string;
  readonly connectionId: string;
  readonly model: string;
  readonly references: ReadonlyArray<ReferenceImage>;
}

const setBadge = (tabId: number, status: RestyleStatus | null) =>
  Effect.promise(async () => {
    const [text, color] =
      status === null
        ? ["", "#000000"]
        : status._tag === "Running"
          ? ["…", "#c026d3"]
          : status._tag === "Done"
            ? ["✓", "#16a34a"]
            : ["!", "#dc2626"];
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
  }).pipe(Effect.ignore);

const recordStatus = (tabId: number, status: RestyleStatus | null) =>
  (status ? Storage.putStatus(tabId, status) : Storage.clearStatus(tabId)).pipe(
    Effect.ignore,
    Effect.andThen(setBadge(tabId, status)),
  );

/**
 * A service worker is stopped after 30 seconds without extension events, even
 * while a fetch is streaming. Calling an extension API resets that timer.
 */
const keepAlive = Effect.acquireRelease(
  Effect.sync(() => setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000)),
  (timer) => Effect.sync(() => clearInterval(timer)),
);

/** Runs Restyle Requests in the background, one per tab. */
export class Restyler extends Context.Service<
  Restyler,
  {
    readonly start: (input: RestyleInput) => Effect.Effect<void>;
    readonly cancel: (tabId: number) => Effect.Effect<void>;
  }
>()("vibecheck/background/Restyler") {
  static readonly layer = Layer.effect(
    Restyler,
    Effect.gen(function* () {
      const pages = yield* Pages;
      const agent = yield* Agent;
      const registrations = yield* Registrations;
      const running = new Map<number, Fiber.Fiber<void, never>>();
      // A new service worker has no running requests, whatever storage still
      // says. Building the layer first keeps this ahead of any new request.
      yield* Storage.failInterruptedRequests.pipe(Effect.ignore);

      const restyle = Effect.fn("Restyler.restyle")(function* (
        { tabId, prompt, connectionId, model, references }: RestyleInput,
        startedAt: number,
      ) {
        const tab = yield* Effect.tryPromise({
          try: () => chrome.tabs.get(tabId),
          catch: () => new RestyleError({ message: "The tab was closed." }),
        });
        const origin = restylableOrigin(tab.url);
        if (!origin)
          return yield* new RestyleError({ message: "vibecheck cannot restyle this page." });
        const connection = (yield* Storage.getConnections).find(
          (candidate) => candidate.id === connectionId,
        );
        if (!connection)
          return yield* new RestyleError({ message: "Choose an AI connection first." });
        if (!model) return yield* new RestyleError({ message: "Choose a model first." });

        yield* pages.ensureContentScript(tabId);
        const picked = yield* Storage.getPicked(tabId);
        const snapshot = yield* pages.snapshot(tabId, picked?.selector ?? null);
        const vision = acceptsImages(connection);
        if (!vision && references.length > 0) {
          return yield* new RestyleError({
            message:
              "This connection does not accept images. Remove the attached image or turn images on in settings.",
          });
        }
        const screenshot = vision
          ? yield* pages.screenshot(tabId).pipe(Effect.orElseSucceed(() => null))
          : null;

        const before = yield* Storage.getSiteStyle(origin);
        const scripts = yield* userScriptsAvailable;
        const result = yield* agent.restyle({
          connection: { ...connection, model },
          tabId,
          scriptsEnabled: scripts,
          onActivity: (activity) =>
            recordStatus(tabId, { _tag: "Running", prompt, startedAt, activity }),
          text: userPrompt({
            request: prompt,
            snapshot,
            current: effectiveFor(before, true),
            hasScreenshot: screenshot !== null,
            references: references.length,
          }),
          images: [...(screenshot ? [screenshot] : []), ...references.map((image) => image.data)],
        });

        const revision: Revision = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          prompt,
          summary: result.summary,
          css: result.css,
          script: result.script,
          model,
        };
        const after = appendRevision(before ?? emptySiteStyle(origin), revision);
        yield* Storage.putSiteStyle(after);
        yield* Storage.clearPicked(tabId);
        yield* registrations.sync;
        yield* registrations.apply(tabId, before, after);
        return result.summary;
      });

      const start = (input: RestyleInput) =>
        Effect.gen(function* () {
          const previous = running.get(input.tabId);
          if (previous) yield* Fiber.interrupt(previous);
          const startedAt = Date.now();
          yield* recordStatus(input.tabId, {
            _tag: "Running",
            prompt: input.prompt,
            startedAt,
            activity: "Reading the page",
          });
          const work = Effect.scoped(Effect.andThen(keepAlive, restyle(input, startedAt))).pipe(
            Effect.matchEffect({
              onSuccess: (summary) => recordStatus(input.tabId, { _tag: "Done", summary }),
              onFailure: (error) =>
                recordStatus(input.tabId, {
                  _tag: "Failed",
                  prompt: input.prompt,
                  message: error.message,
                }),
            }),
            Effect.onInterrupt(() => recordStatus(input.tabId, null)),
            Effect.ensuring(Effect.sync(() => running.delete(input.tabId))),
          );
          running.set(input.tabId, yield* Effect.forkDetach(work));
        });

      const cancel = (tabId: number) =>
        Effect.gen(function* () {
          const fiber = running.get(tabId);
          if (fiber) yield* Fiber.interrupt(fiber);
          else yield* recordStatus(tabId, null);
        });

      return Restyler.of({ start, cancel });
    }),
  );
}
