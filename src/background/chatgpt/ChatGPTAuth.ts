import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import {
  type ChatGPTAccount,
  type Connection,
  type ModelInfo,
  SIGN_IN_RESULT_KEY,
  type SignInResult,
} from "../../domain/Connection.ts";
import * as Storage from "../../shared/storage.ts";
import { ProviderError } from "../providers/ProviderError.ts";
import {
  authorizeUrl,
  ChatGPTModels,
  exchangeClientId,
  isCallbackUrl,
  OPENID_CONFIGURATION_URL,
  parseCallback,
  PendingSignIn,
  pkceChallenge,
  PLAN_SCOPE,
  randomToken,
  REDIRECT_URI,
  RESOURCE,
  TERMINAL_REFRESH_ERRORS,
  TOKEN_URL,
  TokenError,
  TokenResponse,
  verifyIdToken,
} from "./oauth.ts";

type ChatGPTConnection = Extract<Connection, { _tag: "chatgpt" }>;

class SignInError extends Schema.TaggedError<SignInError>()("SignInError", {
  message: Schema.String,
}) {}

const PENDING_KEY = "signin:pending";
// Refresh a little early so a long Restyle Request never starts with a dying token.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const OpenIdConfiguration = Schema.Struct({
  jwks_uri: Schema.String,
  revocation_endpoint: Schema.optional(Schema.String),
});

interface HttpResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

const request = (url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: async (signal): Promise<HttpResult> => {
      const response = await fetch(url, { ...init, signal });
      const body: unknown = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body };
    },
    catch: (cause) => new SignInError({ message: `Could not reach OpenAI: ${String(cause)}` }),
  });

const postForm = (url: string, form: Record<string, string>) =>
  request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });

const tokenErrorCode = (body: unknown) => {
  const decoded = Schema.decodeUnknownOption(TokenError)(body);
  return decoded._tag === "Some" ? decoded.value.error : null;
};

const openIdConfiguration = request(OPENID_CONFIGURATION_URL, {}).pipe(
  Effect.flatMap((result) => Schema.decodeUnknownEffect(OpenIdConfiguration)(result.body)),
  Effect.mapError(
    () => new SignInError({ message: "Could not load OpenAI's sign-in configuration" }),
  ),
);

const fetchModels = (accessToken: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${RESOURCE}/models`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as unknown;
    },
    catch: (cause) =>
      new ProviderError({ message: `Could not list ChatGPT models: ${String(cause)}` }),
  }).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(ChatGPTModels)(body).pipe(
        Effect.mapError(
          () => new ProviderError({ message: "ChatGPT returned an unexpected model list" }),
        ),
      ),
    ),
    Effect.map(({ models }): Array<ModelInfo> =>
      models
        .filter((model) => (model.visibility ?? "list") === "list")
        .map((model) => ({ id: model.slug, label: model.display_name ?? model.slug })),
    ),
  );

const findChatGPT = (connections: ReadonlyArray<Connection>, id: string) =>
  connections.find(
    (connection): connection is ChatGPTConnection =>
      connection.id === id && connection._tag === "chatgpt",
  );

const updateAccount = Effect.fnUntraced(function* (connectionId: string, account: ChatGPTAccount) {
  const connections = yield* Storage.getConnections;
  const connection = findChatGPT(connections, connectionId);
  if (!connection) return;
  yield* Storage.saveConnection({ ...connection, account });
});

const signInFailed = (message: string) => new SignInError({ message });

const deniedMessage = (error: string) =>
  error === "access_denied"
    ? "ChatGPT access was not granted."
    : `ChatGPT sign-in failed: ${error}`;

/** Matches the callback to the pending attempt and picks the client to exchange the code with. */
const acceptCallback = Effect.fnUntraced(function* (url: string) {
  const pending = yield* Storage.readSession(PENDING_KEY, PendingSignIn);
  const callback = parseCallback(url);
  if (!pending || callback.state !== pending.state) {
    return yield* signInFailed("This sign-in link has expired. Try again.");
  }
  yield* Storage.removeSession(PENDING_KEY);
  if (callback._tag === "Denied") return yield* signInFailed(deniedMessage(callback.error));
  const clientId = exchangeClientId(pending, callback);
  if (!clientId)
    return yield* signInFailed("ChatGPT did not finish registering vibecheck. Try again.");
  return { pending, callback, clientId };
});

const exchangeCode = Effect.fnUntraced(function* (
  code: string,
  clientId: string,
  verifier: string,
) {
  const exchange = yield* postForm(TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
  });
  if (!exchange.ok) {
    const reason = tokenErrorCode(exchange.body) ?? `HTTP ${exchange.status}`;
    return yield* signInFailed(`ChatGPT rejected the sign-in (${reason}). Try again.`);
  }
  const tokens = yield* Schema.decodeUnknownEffect(TokenResponse)(exchange.body).pipe(
    Effect.mapError(() => signInFailed("ChatGPT returned an unexpected token response")),
  );
  if (!tokens.id_token) return yield* signInFailed("ChatGPT returned no ID token");
  return { ...tokens, id_token: tokens.id_token };
});

const verifiedIdentity = Effect.fnUntraced(function* (
  idToken: string,
  clientId: string,
  nonce: string,
) {
  const configuration = yield* openIdConfiguration;
  const jwks = yield* request(configuration.jwks_uri, {});
  return yield* verifyIdToken(idToken, {
    jwks: jwks.body,
    clientId,
    nonce,
    nowSeconds: Math.floor(Date.now() / 1000),
  }).pipe(Effect.mapError((error) => signInFailed(error.message)));
});

/** Saves the account on its existing connection, or on a new one. Returns the email. */
const saveAccount = Effect.fnUntraced(function* (
  connectionId: string | null,
  account: ChatGPTAccount,
) {
  const previous = connectionId
    ? findChatGPT(yield* Storage.getConnections, connectionId)
    : undefined;
  if (previous && previous.account.subject !== account.subject) {
    return yield* signInFailed("You signed in with a different ChatGPT account.");
  }
  const email = account.email || previous?.account.email || "";
  const firstModel = Effect.suspend(() => fetchModels(account.accessToken ?? "")).pipe(
    Effect.map((models) => models[0]?.id ?? ""),
    Effect.orElseSucceed(() => ""),
  );
  yield* Storage.saveConnection({
    _tag: "chatgpt",
    id: previous?.id ?? crypto.randomUUID(),
    label: email ? `ChatGPT (${email})` : "ChatGPT",
    model: previous?.model ?? (yield* firstModel),
    account: { ...account, email },
  });
  return email;
});

const completeSignIn = Effect.fnUntraced(function* (url: string) {
  const { pending, callback, clientId } = yield* acceptCallback(url);
  const tokens = yield* exchangeCode(callback.code, clientId, pending.verifier);
  const claims = yield* verifiedIdentity(tokens.id_token, clientId, pending.nonce);
  const scopes = (tokens.scope ?? callback.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(PLAN_SCOPE)) {
    return yield* signInFailed(
      "ChatGPT plan usage was not allowed. Sign in again and allow vibecheck to use your plan.",
    );
  }
  return yield* saveAccount(pending.connectionId, {
    clientId,
    subject: claims.sub,
    email: claims.email ?? "",
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes,
  });
});

export class ChatGPTAuth extends Context.Service<
  ChatGPTAuth,
  {
    readonly signIn: (
      connectionId: string | null,
    ) => Effect.Effect<void, SignInError | Storage.StorageError>;
    readonly handleNavigation: (tabId: number, url: string) => Effect.Effect<void>;
    readonly accessToken: (connection: ChatGPTConnection) => Effect.Effect<string, ProviderError>;
    readonly signOut: (
      connectionId: string,
    ) => Effect.Effect<void, SignInError | Storage.StorageError>;
    readonly listModels: (
      connection: ChatGPTConnection,
    ) => Effect.Effect<Array<ModelInfo>, ProviderError>;
  }
>()("vibecheck/background/chatgpt/ChatGPTAuth") {
  static readonly layer = Layer.effect(
    ChatGPTAuth,
    Effect.gen(function* () {
      const refreshLock = yield* Semaphore.make(1);

      const signIn = Effect.fn("ChatGPTAuth.signIn")(function* (connectionId: string | null) {
        const existing = connectionId
          ? findChatGPT(yield* Storage.getConnections, connectionId)
          : undefined;
        const pending: PendingSignIn = {
          state: randomToken(),
          nonce: randomToken(),
          verifier: randomToken(),
          clientId: existing?.account.clientId ?? null,
          connectionId: existing?.id ?? null,
        };
        const challenge = yield* Effect.promise(() => pkceChallenge(pending.verifier));
        const hostId = yield* Storage.getHostId;
        yield* Storage.removeSession(SIGN_IN_RESULT_KEY);
        yield* Storage.writeSession(PENDING_KEY, pending);
        const url = authorizeUrl({
          pending,
          challenge,
          hostId,
          idTokenHint: existing?.account.idToken ?? null,
          loginHint: existing?.account.email ?? null,
        });
        yield* Effect.tryPromise({
          try: () => chrome.tabs.create({ url }),
          catch: () => new SignInError({ message: "Could not open the ChatGPT sign-in page" }),
        });
      });

      const handleNavigation = Effect.fn("ChatGPTAuth.handleNavigation")(function* (
        tabId: number,
        url: string,
      ) {
        if (!isCallbackUrl(url)) return;
        // Show the outcome in settings instead of the unreachable loopback page.
        yield* Effect.promise(() =>
          chrome.tabs.update(tabId, {
            url: chrome.runtime.getURL("options/index.html#connections"),
          }),
        ).pipe(Effect.ignore);
        const result: SignInResult = yield* completeSignIn(url).pipe(
          Effect.map((email): SignInResult => ({ _tag: "SignedIn", email })),
          Effect.catch((error) =>
            Effect.succeed<SignInResult>({ _tag: "SignInFailed", message: error.message }),
          ),
        );
        yield* Storage.writeSession(SIGN_IN_RESULT_KEY, result).pipe(Effect.ignore);
      });

      const refresh = Effect.fnUntraced(function* (connection: ChatGPTConnection) {
        // Another request may have refreshed while this one waited for the lock.
        const latest = findChatGPT(yield* Storage.getConnections, connection.id) ?? connection;
        const { account } = latest;
        if (account.accessToken && account.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
          return account.accessToken;
        }
        if (!account.refreshToken) {
          return yield* new ProviderError({
            message: "Sign in to ChatGPT again in vibecheck settings.",
          });
        }
        const result = yield* postForm(TOKEN_URL, {
          grant_type: "refresh_token",
          client_id: account.clientId,
          refresh_token: account.refreshToken,
          resource: RESOURCE,
        });
        if (!result.ok) {
          const code = tokenErrorCode(result.body);
          if (code && TERMINAL_REFRESH_ERRORS.has(code)) {
            yield* updateAccount(latest.id, { ...account, accessToken: null, refreshToken: null });
            return yield* new ProviderError({
              message: "Your ChatGPT session ended. Sign in again in settings.",
            });
          }
          return yield* new ProviderError({
            message: `Could not refresh the ChatGPT session (${code ?? `HTTP ${result.status}`}).`,
          });
        }
        const tokens = yield* Schema.decodeUnknownEffect(TokenResponse)(result.body);
        yield* updateAccount(latest.id, {
          ...account,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? account.refreshToken,
          idToken: tokens.id_token ?? account.idToken,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scopes: tokens.scope ? tokens.scope.split(" ") : account.scopes,
        });
        return tokens.access_token;
      });

      const accessToken = (connection: ChatGPTConnection) =>
        refreshLock
          .withPermit(refresh(connection))
          .pipe(
            Effect.mapError((error) =>
              error instanceof ProviderError
                ? error
                : new ProviderError({ message: `ChatGPT: ${error.message}` }),
            ),
          );

      const signOut = Effect.fn("ChatGPTAuth.signOut")(function* (connectionId: string) {
        const connection = findChatGPT(yield* Storage.getConnections, connectionId);
        if (!connection) return;
        const { account } = connection;
        if (account.refreshToken) {
          const configuration = yield* openIdConfiguration.pipe(Effect.option);
          const endpoint =
            configuration._tag === "Some" ? configuration.value.revocation_endpoint : undefined;
          if (endpoint) {
            yield* postForm(endpoint, {
              token: account.refreshToken,
              token_type_hint: "refresh_token",
              client_id: account.clientId,
            }).pipe(Effect.ignore);
          }
        }
        // Keep the registration so the next sign-in reuses the issued client.
        yield* updateAccount(connectionId, {
          ...account,
          accessToken: null,
          refreshToken: null,
          idToken: null,
        });
      });

      const listModels = (connection: ChatGPTConnection) =>
        accessToken(connection).pipe(Effect.flatMap(fetchModels));

      return ChatGPTAuth.of({ signIn, handleNavigation, accessToken, signOut, listModels });
    }),
  );
}
