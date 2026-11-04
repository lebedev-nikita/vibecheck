import { assert, describe, it } from "@effect/vitest";
import { chatModels, normalizeBaseUrl } from "./Connection.ts";

describe("normalizeBaseUrl", () => {
  it("adds /v1 to a bare host", () => {
    assert.strictEqual(normalizeBaseUrl("http://proxy.lan"), "http://proxy.lan/v1");
    assert.strictEqual(normalizeBaseUrl(" http://localhost:11434/ "), "http://localhost:11434/v1");
  });

  it("keeps an explicit API path", () => {
    assert.strictEqual(
      normalizeBaseUrl("https://openrouter.ai/api/v1/"),
      "https://openrouter.ai/api/v1",
    );
    assert.strictEqual(normalizeBaseUrl("http://127.0.0.1:8317/v1"), "http://127.0.0.1:8317/v1");
  });

  it("rejects anything that is not an http(s) URL", () => {
    assert.isNull(normalizeBaseUrl("proxy.lan"));
    assert.isNull(normalizeBaseUrl("ftp://example.com"));
    assert.isNull(normalizeBaseUrl(""));
  });
});

describe("chatModels", () => {
  it("drops image and embedding models and sorts the rest", () => {
    const models = [
      "gpt-image-2",
      "claude-sonnet-5-5",
      "text-embedding-3",
      "codex-auto-review",
      "gpt-6.1-sol",
    ].map((id) => ({ id, label: id }));
    assert.deepStrictEqual(
      chatModels(models).map((model) => model.id),
      ["claude-sonnet-5-5", "codex-auto-review", "gpt-6.1-sol"],
    );
  });
});
