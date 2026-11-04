import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import {
  OpenAiClient as CompatibleClient,
  OpenAiLanguageModel as CompatibleLanguageModel,
} from "@effect/ai-openai-compat";
import { Effect, Layer, Redacted, Schema } from "effect";
import type { LanguageModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import {
  chatModels,
  type Connection,
  type ModelInfo,
  providerName,
} from "../../domain/Connection.ts";
import { ProviderError } from "../providers/ProviderError.ts";
import { groupToolsInNamespace } from "./namespace.ts";

const ANTHROPIC_URL = "https://api.anthropic.com";
const OPENAI_URL = "https://api.openai.com/v1";

// Anthropic only answers browser-origin requests that acknowledge the key is
// exposed to the browser, which is inherent to a bring-your-own-key extension.
const allowBrowserAccess = HttpClient.mapRequest(
  HttpClientRequest.setHeader("anthropic-dangerous-direct-browser-access", "true"),
);

/** Rewrites Responses API request bodies into the shape ChatGPT plan usage accepts. */
const chatGPTRequests = HttpClient.mapRequest((request) => {
  const { body } = request;
  if (body._tag !== "Uint8Array" || !body.contentType.includes("json")) return request;
  const json: unknown = JSON.parse(body.text ?? new TextDecoder().decode(body.body));
  if (typeof json !== "object" || json === null) return request;
  return HttpClientRequest.bodyJsonUnsafe(
    request,
    groupToolsInNamespace(json as Record<string, unknown>),
  );
});

/**
 * The Effect AI language model for a connection. `token` is the ChatGPT access
 * token, which the caller refreshes first.
 */
export const languageModelFor = (
  connection: Connection,
  token: string | null,
): Layer.Layer<LanguageModel.LanguageModel> => {
  switch (connection._tag) {
    case "anthropic":
      return AnthropicLanguageModel.model(connection.model, { max_tokens: 32_000 }).pipe(
        Layer.provide(
          AnthropicClient.layer({
            apiKey: Redacted.make(connection.apiKey),
            transformClient: allowBrowserAccess,
          }),
        ),
        Layer.provide(FetchHttpClient.layer),
      );
    case "openai":
      return OpenAiLanguageModel.model(connection.model, {
        store: false,
        reasoningModel: true,
      }).pipe(
        Layer.provide(OpenAiClient.layer({ apiKey: Redacted.make(connection.apiKey) })),
        Layer.provide(FetchHttpClient.layer),
      );
    case "chatgpt":
      // Plan usage requires `store: false`, streaming and developer (not system) messages.
      return OpenAiLanguageModel.model(connection.model, {
        store: false,
        reasoningModel: true,
      }).pipe(
        Layer.provide(
          OpenAiClient.layer({
            apiKey: Redacted.make(token ?? ""),
            transformClient: chatGPTRequests,
          }),
        ),
        Layer.provide(FetchHttpClient.layer),
      );
    case "openai-compatible":
      return CompatibleLanguageModel.model(connection.model).pipe(
        Layer.provide(
          CompatibleClient.layer({
            apiUrl: connection.baseUrl,
            ...(connection.apiKey ? { apiKey: Redacted.make(connection.apiKey) } : {}),
          }),
        ),
        Layer.provide(FetchHttpClient.layer),
      );
  }
};

const ModelPage = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({ id: Schema.String, display_name: Schema.optional(Schema.String) }),
  ),
});

const OPENAI_CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;

const modelsRequest = (connection: Exclude<Connection, { _tag: "chatgpt" }>) => {
  switch (connection._tag) {
    case "anthropic":
      return HttpClientRequest.get(`${ANTHROPIC_URL}/v1/models?limit=1000`).pipe(
        HttpClientRequest.setHeaders({
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        }),
      );
    case "openai":
      return HttpClientRequest.get(`${OPENAI_URL}/models`).pipe(
        HttpClientRequest.bearerToken(connection.apiKey),
      );
    case "openai-compatible": {
      const request = HttpClientRequest.get(`${connection.baseUrl}/models`);
      return connection.apiKey
        ? HttpClientRequest.bearerToken(request, connection.apiKey)
        : request;
    }
  }
};

const statusMessage = (provider: string, status: number) => {
  switch (status) {
    case 401:
    case 403:
      return `${provider} rejected the credentials. Check the API key.`;
    case 404:
      return `${provider} has no model list at this address. Check the URL.`;
    default:
      return `${provider} answered with HTTP ${status}.`;
  }
};

/** The chat models a connection offers; also how saving a connection checks it. */
export const listModelsFor = (connection: Exclude<Connection, { _tag: "chatgpt" }>) => {
  const provider = providerName(connection._tag);
  return HttpClient.execute(modelsRequest(connection)).pipe(
    Effect.mapError(() => new ProviderError({ message: `Could not reach ${provider}.` })),
    Effect.flatMap((response) =>
      response.status >= 400
        ? Effect.fail(new ProviderError({ message: statusMessage(provider, response.status) }))
        : HttpClientResponse.schemaBodyJson(ModelPage)(response).pipe(
            Effect.mapError(
              () =>
                new ProviderError({ message: `${provider} returned an unexpected model list.` }),
            ),
          ),
    ),
    Effect.map(({ data }): Array<ModelInfo> => {
      const models = data.map((model) => ({ id: model.id, label: model.display_name ?? model.id }));
      return chatModels(
        connection._tag === "openai"
          ? models.filter((model) => OPENAI_CHAT_MODEL.test(model.id))
          : models,
      );
    }),
    Effect.provide(FetchHttpClient.layer),
  );
};
