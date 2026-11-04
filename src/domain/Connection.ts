import { Schema } from "effect";

const ChatGPTAccount = Schema.Struct({
  /** The `oaiapp_…` client issued during dynamic registration. */
  clientId: Schema.String,
  subject: Schema.String,
  email: Schema.String,
  idToken: Schema.NullOr(Schema.String),
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
  scopes: Schema.Array(Schema.String),
});
export type ChatGPTAccount = typeof ChatGPTAccount.Type;

const common = {
  id: Schema.String,
  label: Schema.String,
  model: Schema.String,
};

const AnthropicConnection = Schema.TaggedStruct("anthropic", {
  ...common,
  apiKey: Schema.String,
});

const OpenAIConnection = Schema.TaggedStruct("openai", {
  ...common,
  apiKey: Schema.String,
});

const CompatibleConnection = Schema.TaggedStruct("openai-compatible", {
  ...common,
  baseUrl: Schema.String,
  apiKey: Schema.String,
  vision: Schema.Boolean,
});

const ChatGPTConnection = Schema.TaggedStruct("chatgpt", {
  ...common,
  account: ChatGPTAccount,
});

export const Connection = Schema.Union([
  AnthropicConnection,
  OpenAIConnection,
  CompatibleConnection,
  ChatGPTConnection,
]);
export type Connection = typeof Connection.Type;
export type ConnectionKind = Connection["_tag"];

export const providerName = (kind: ConnectionKind): string => {
  switch (kind) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openai-compatible":
      return "OpenAI-compatible";
    case "chatgpt":
      return "ChatGPT";
  }
};

export const acceptsImages = (connection: Connection): boolean =>
  connection._tag === "openai-compatible" ? connection.vision : true;

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

/**
 * The API root of an OpenAI-compatible server. OpenAI-style APIs live under
 * `/v1`, so a bare host such as `http://proxy.lan` gets it appended.
 */
export const normalizeBaseUrl = (input: string): string | null => {
  const url = URL.parse(input.trim());
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path || "/v1"}`;
};

// Models that cannot answer a Restyle Request: image, audio and embedding models.
const NOT_CHAT = /(image|dall-e|audio|realtime|transcribe|tts|whisper|embedding|moderation)/i;

/** Chat models only, in a stable order for pickers. */
export const chatModels = (models: ReadonlyArray<ModelInfo>): Array<ModelInfo> =>
  models.filter((model) => !NOT_CHAT.test(model.id)).sort((a, b) => a.id.localeCompare(b.id));

export const ModelInfo = Schema.Struct({ id: Schema.String, label: Schema.String });
export type ModelInfo = typeof ModelInfo.Type;

export const Settings = Schema.Struct({
  activeConnectionId: Schema.NullOr(Schema.String),
});
export type Settings = typeof Settings.Type;

/** The outcome of the last Sign in with ChatGPT attempt, shown in settings. */
export const SignInResult = Schema.Union([
  Schema.TaggedStruct("SignedIn", { email: Schema.String }),
  Schema.TaggedStruct("SignInFailed", { message: Schema.String }),
]);
export type SignInResult = typeof SignInResult.Type;
export const SIGN_IN_RESULT_KEY = "signin:result";
