import { Effect, Schema } from "effect";

// Sign in with ChatGPT for open-source apps:
// https://learn.chatgpt.com/siwc/token-sharing-open-source/sign-in
const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const OPENID_CONFIGURATION_URL = `${ISSUER}/.well-known/openid-configuration`;
export const RESOURCE = "https://api.openai.com/v1";
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const AGENT_NAME = "vibecheck";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;

// OpenAI only accepts loopback redirects. Nothing listens on this port: the
// service worker catches the navigation before the browser tries to load it.
export const CALLBACK_HOST = "127.0.0.1";
export const CALLBACK_PORT = 1455;
export const CALLBACK_PATH = "/auth/callback";
export const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

export const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const randomToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const pkceChallenge = async (verifier: string) =>
  base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );

/** One sign-in attempt, kept in session storage until the callback arrives. */
export const PendingSignIn = Schema.Struct({
  state: Schema.String,
  nonce: Schema.String,
  verifier: Schema.String,
  /** The issued client for a returning account; null for a first registration. */
  clientId: Schema.NullOr(Schema.String),
  connectionId: Schema.NullOr(Schema.String),
});
export type PendingSignIn = typeof PendingSignIn.Type;

export interface AuthorizeParams {
  readonly pending: PendingSignIn;
  readonly challenge: string;
  readonly hostId: string;
  readonly idTokenHint: string | null;
  readonly loginHint: string | null;
}

export const authorizeUrl = ({
  pending,
  challenge,
  hostId,
  idTokenHint,
  loginHint,
}: AuthorizeParams) => {
  const url = new URL(AUTHORIZE_URL);
  const params = url.searchParams;
  params.set("client_id", pending.clientId ?? REGISTRATION_CLIENT_ID);
  if (!pending.clientId) params.set("agent_name_hint", AGENT_NAME);
  params.set("ext_agent_host_id", hostId);
  if (idTokenHint) params.set("id_token_hint", idTokenHint);
  if (loginHint) params.set("login_hint", loginHint);
  params.set("response_type", "code");
  params.set("redirect_uri", REDIRECT_URI);
  params.set("scope", SCOPES);
  params.set("resource", RESOURCE);
  params.set("state", pending.state);
  params.set("nonce", pending.nonce);
  params.set("code_challenge_method", "S256");
  params.set("code_challenge", challenge);
  return url.toString();
};

export const isCallbackUrl = (url: string) => {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    parsed.protocol === "http:" &&
    parsed.hostname === CALLBACK_HOST &&
    parsed.port === String(CALLBACK_PORT) &&
    parsed.pathname === CALLBACK_PATH
  );
};

export type Callback =
  | { readonly _tag: "Denied"; readonly state: string | null; readonly error: string }
  | {
      readonly _tag: "Code";
      readonly state: string | null;
      readonly code: string;
      readonly clientId: string | null;
      readonly scope: string | null;
    };

export const parseCallback = (url: string): Callback => {
  const params = new URL(url).searchParams;
  const state = params.get("state");
  const error = params.get("error");
  const code = params.get("code");
  if (error || !code) return { _tag: "Denied", state, error: error ?? "missing_code" };
  return {
    _tag: "Code",
    state,
    code,
    clientId: params.get("client_id"),
    scope: params.get("scope"),
  };
};

/**
 * The client used for the token exchange. A returning account must keep its
 * registration; a callback naming another client is rejected.
 */
export const exchangeClientId = (pending: PendingSignIn, callback: Callback & { _tag: "Code" }) => {
  if (pending.clientId) {
    return callback.clientId && callback.clientId !== pending.clientId ? null : pending.clientId;
  }
  return callback.clientId;
};

export const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  scope: Schema.optional(Schema.String),
});

export const TokenError = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
});

/** Refresh errors after which the token set can never work again. */
export const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

const IdTokenClaims = Schema.Struct({
  iss: Schema.String,
  sub: Schema.String,
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  exp: Schema.Number,
  nonce: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
});

class IdTokenError extends Schema.TaggedError<IdTokenError>()("IdTokenError", {
  message: Schema.String,
}) {}

const Jwk = Schema.Struct({
  kid: Schema.optional(Schema.String),
  kty: Schema.String,
  alg: Schema.optional(Schema.String),
});
const Jwks = Schema.Struct({ keys: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });
const JwtHeader = Schema.Struct({ alg: Schema.String, kid: Schema.optional(Schema.String) });

const decodeJson = <S extends Schema.Top>(schema: S, bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(new TextDecoder().decode(bytes));

const verifyAlgorithm = (alg: string) => {
  switch (alg) {
    case "RS256":
      return {
        importAs: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        verifyAs: { name: "RSASSA-PKCS1-v1_5" },
      } as const;
    case "ES256":
      return {
        importAs: { name: "ECDSA", namedCurve: "P-256" },
        verifyAs: { name: "ECDSA", hash: "SHA-256" },
      } as const;
    default:
      return null;
  }
};

export interface ExpectedIdToken {
  readonly jwks: unknown;
  readonly clientId: string;
  readonly nonce: string;
  readonly nowSeconds: number;
}

/** Verifies the ID token signature against OpenAI's JWKS and checks its claims. */
export const verifyIdToken = Effect.fnUntraced(function* (
  token: string,
  expected: ExpectedIdToken,
) {
  const invalid = (message: string) => new IdTokenError({ message });
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return yield* invalid("Malformed ID token");

  const header = yield* decodeJson(JwtHeader, fromBase64Url(headerPart)).pipe(
    Effect.mapError(() => invalid("Malformed ID token header")),
  );
  const algorithm = verifyAlgorithm(header.alg);
  if (!algorithm) return yield* invalid(`Unsupported ID token algorithm ${header.alg}`);

  const { keys } = yield* Schema.decodeUnknownEffect(Jwks)(expected.jwks).pipe(
    Effect.mapError(() => invalid("Malformed JWKS")),
  );
  const jwk = keys.find((key) => {
    const decoded = Schema.decodeUnknownOption(Jwk)(key);
    return decoded._tag === "Some" && (!header.kid || decoded.value.kid === header.kid);
  });
  if (!jwk) return yield* invalid("No signing key matches the ID token");

  const valid = yield* Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey("jwk", jwk, algorithm.importAs, false, ["verify"]);
      return crypto.subtle.verify(
        algorithm.verifyAs,
        key,
        fromBase64Url(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`),
      );
    },
    catch: () => invalid("Could not verify the ID token signature"),
  });
  if (!valid) return yield* invalid("The ID token signature is invalid");

  const claims = yield* decodeJson(IdTokenClaims, fromBase64Url(payloadPart)).pipe(
    Effect.mapError(() => invalid("Malformed ID token claims")),
  );
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (claims.iss !== ISSUER) return yield* invalid("The ID token has the wrong issuer");
  if (!audiences.includes(expected.clientId))
    return yield* invalid("The ID token has the wrong audience");
  if (claims.exp <= expected.nowSeconds) return yield* invalid("The ID token has expired");
  if (claims.nonce !== expected.nonce) return yield* invalid("The ID token nonce does not match");
  return claims;
});

export const ChatGPTModels = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      display_name: Schema.optional(Schema.String),
      visibility: Schema.optional(Schema.String),
    }),
  ),
});
