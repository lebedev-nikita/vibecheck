import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  authorizeUrl,
  base64Url,
  exchangeClientId,
  isCallbackUrl,
  parseCallback,
  type PendingSignIn,
  pkceChallenge,
  REDIRECT_URI,
  verifyIdToken,
} from "./oauth.ts";

const pending: PendingSignIn = {
  state: "s",
  nonce: "n",
  verifier: "v",
  clientId: null,
  connectionId: null,
};

describe("Sign in with ChatGPT", () => {
  it("registers a new client on first sign-in", () => {
    const url = new URL(
      authorizeUrl({
        pending,
        challenge: "c",
        hostId: "urn:uuid:1",
        idTokenHint: null,
        loginHint: null,
      }),
    );
    assert.strictEqual(url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.strictEqual(url.searchParams.get("agent_name_hint"), "vibecheck");
    assert.strictEqual(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
    assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    assert.include(url.searchParams.get("scope") ?? "", "chatgpt.tokens.use.direct");
  });

  it("reuses the issued client and omits the agent name later", () => {
    const url = new URL(
      authorizeUrl({
        pending: { ...pending, clientId: "oaiapp_1" },
        challenge: "c",
        hostId: "h",
        idTokenHint: "t",
        loginHint: "a@b.c",
      }),
    );
    assert.strictEqual(url.searchParams.get("client_id"), "oaiapp_1");
    assert.isNull(url.searchParams.get("agent_name_hint"));
    assert.strictEqual(url.searchParams.get("id_token_hint"), "t");
  });

  it("recognises only the exact loopback callback", () => {
    assert.isTrue(isCallbackUrl(`${REDIRECT_URI}?code=x`));
    assert.isFalse(isCallbackUrl("http://localhost:1455/auth/callback?code=x"));
    assert.isFalse(isCallbackUrl("http://127.0.0.1:1455/callback?code=x"));
  });

  it("keeps a returning account on its own client", () => {
    const callback = parseCallback(`${REDIRECT_URI}?code=c&state=s&client_id=oaiapp_2`);
    assert.strictEqual(callback._tag, "Code");
    if (callback._tag !== "Code") return;
    assert.strictEqual(exchangeClientId(pending, callback), "oaiapp_2");
    assert.isNull(exchangeClientId({ ...pending, clientId: "oaiapp_1" }, callback));
  });

  it("reports a declined consent", () => {
    assert.deepStrictEqual(parseCallback(`${REDIRECT_URI}?error=access_denied&state=s`), {
      _tag: "Denied",
      state: "s",
      error: "access_denied",
    });
  });

  it("derives the RFC 7636 PKCE challenge", async () => {
    // Test vector from RFC 7636, appendix B.
    assert.strictEqual(
      await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

const signedToken = async (claims: Record<string, unknown>) => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
  const body = `${encode({ alg: "RS256", kid: "k1" })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(body),
  );
  return { token: `${body}.${base64Url(new Uint8Array(signature))}`, jwks: { keys: [jwk] } };
};

const claims = {
  iss: "https://auth.openai.com",
  sub: "user",
  aud: "oaiapp_1",
  exp: 2_000,
  nonce: "n",
  email: "a@b.c",
};

describe("verifyIdToken", () => {
  it.effect("accepts a valid token", () =>
    Effect.gen(function* () {
      const { token, jwks } = yield* Effect.promise(() => signedToken(claims));
      const verified = yield* verifyIdToken(token, {
        jwks,
        clientId: "oaiapp_1",
        nonce: "n",
        nowSeconds: 1_000,
      });
      assert.strictEqual(verified.sub, "user");
    }),
  );

  it.effect("rejects a wrong nonce, audience or an expired token", () =>
    Effect.gen(function* () {
      const { token, jwks } = yield* Effect.promise(() => signedToken(claims));
      for (const expected of [
        { jwks, clientId: "oaiapp_1", nonce: "other", nowSeconds: 1_000 },
        { jwks, clientId: "oaiapp_2", nonce: "n", nowSeconds: 1_000 },
        { jwks, clientId: "oaiapp_1", nonce: "n", nowSeconds: 3_000 },
      ]) {
        const error = yield* Effect.flip(verifyIdToken(token, expected));
        assert.strictEqual(error._tag, "IdTokenError");
      }
    }),
  );

  it.effect("rejects a token signed by another key", () =>
    Effect.gen(function* () {
      const { token } = yield* Effect.promise(() => signedToken(claims));
      const { jwks } = yield* Effect.promise(() => signedToken(claims));
      const error = yield* Effect.flip(
        verifyIdToken(token, { jwks, clientId: "oaiapp_1", nonce: "n", nowSeconds: 1_000 }),
      );
      assert.strictEqual(error.message, "The ID token signature is invalid");
    }),
  );
});
