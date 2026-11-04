import { Schema } from "effect";
import type { AiError } from "effect/ai";

export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  message: Schema.String,
}) {}

// Error codes ChatGPT plan usage returns, with what the user can do about them.
// https://learn.chatgpt.com/siwc/token-sharing-open-source/errors-and-recovery
const CHATGPT_ERRORS: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded:
    "Your ChatGPT usage limit for vibecheck is reached. Check ChatGPT Settings → Usage.",
  subscription_sharing_usage_unavailable:
    "ChatGPT could not check your usage right now. Try again in a minute.",
  subscription_sharing_user_not_eligible:
    "ChatGPT plan usage is not available for this account or workspace.",
  subscription_sharing_unsupported_capability:
    "This ChatGPT model does not support the request. Pick another model.",
  subscription_sharing_invalid_user: "ChatGPT could not validate your account. Sign in again.",
};

const ErrorBody = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({ code: Schema.optional(Schema.NullOr(Schema.String)) }),
  }),
);

/** The provider's own error code, when the response body carries one. */
const errorCode = (body: string | undefined) => {
  if (!body) return null;
  const decoded = Schema.decodeUnknownOption(ErrorBody)(body);
  return decoded._tag === "Some" ? (decoded.value.error.code ?? null) : null;
};

const httpOf = (reason: AiError.AiError["reason"]) =>
  "http" in reason
    ? (reason.http as { body?: string; response?: { status: number } } | undefined)
    : undefined;

/** Turns an Effect AI failure into a message the popup can show as is. */
export const fromAiError =
  (provider: string) =>
  (error: AiError.AiError): ProviderError => {
    const { reason } = error;
    const http = httpOf(reason);
    const code = errorCode(http?.body);
    if (code && CHATGPT_ERRORS[code]) return new ProviderError({ message: CHATGPT_ERRORS[code] });
    switch (reason._tag) {
      case "AuthenticationError":
        return new ProviderError({
          message: `${provider} rejected the credentials. Check the connection in settings.`,
        });
      case "RateLimitError":
        return new ProviderError({
          message: `${provider} is rate limiting requests. Wait a moment and try again.`,
        });
      case "QuotaExhaustedError":
        return new ProviderError({ message: `Your ${provider} quota is used up.` });
      case "ContentPolicyError":
        return new ProviderError({ message: "The model declined this request." });
      case "NetworkError":
        return new ProviderError({ message: `Could not reach ${provider}. Check the connection.` });
      default:
        if (http?.response?.status === 404) {
          return new ProviderError({
            message: `${provider} does not know this model. Pick another one.`,
          });
        }
        return new ProviderError({ message: `${provider} request failed: ${error.message}` });
    }
  };

/** Whether a failure means the server rejected the request shape, not the user. */
export const isInvalidRequest = (error: AiError.AiError) =>
  error.reason._tag === "InvalidRequestError" ||
  error.reason._tag === "ToolConfigurationError" ||
  error.reason._tag === "UnsupportedSchemaError";
