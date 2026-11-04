import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseModelOutput, systemPrompt, userPrompt } from "./prompt.ts";

const snapshot = {
  url: "https://example.com/",
  title: "Example",
  viewport: { width: 1280, height: 800 },
  outline: "body\n  main",
  tokens: "--brand: #f00",
  styles: "body: color: black",
  selected: { selector: "main > h1", html: "<h1>Hi</h1>", styles: "color: black" },
};

describe("parseModelOutput", () => {
  it.effect("reads a plain JSON reply", () =>
    Effect.gen(function* () {
      const result = yield* parseModelOutput('{"summary":"Dark","css":"body{}","script":""}');
      assert.deepStrictEqual(result, { summary: "Dark", css: "body{}", script: "" });
    }),
  );

  it.effect("reads JSON wrapped in a Markdown fence and prose", () =>
    Effect.gen(function* () {
      const result = yield* parseModelOutput(
        'Here you go:\n```json\n{"summary":"s","css":"a{}","script":"x()"}\n```',
      );
      assert.strictEqual(result.script, "x()");
    }),
  );

  it.effect("rejects a reply without the Site Style fields", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseModelOutput('{"css":"a{}"}'));
      assert.strictEqual(error._tag, "InvalidModelOutput");
    }),
  );
});

describe("prompts", () => {
  it("tells the model to skip scripts when Page Scripts are off", () => {
    assert.include(
      systemPrompt({ scriptsEnabled: false, tools: true }),
      "Page Scripts are turned off",
    );
    assert.notInclude(
      systemPrompt({ scriptsEnabled: true, tools: true }),
      "Page Scripts are turned off",
    );
  });

  it("describes the tools or the JSON reply, depending on the mode", () => {
    assert.include(systemPrompt({ scriptsEnabled: true, tools: true }), "submit_site_style");
    assert.notInclude(systemPrompt({ scriptsEnabled: true, tools: true }), "JSON object");
    assert.include(systemPrompt({ scriptsEnabled: true, tools: false }), "JSON object");
  });

  it("includes the request, current Site Style and picked element", () => {
    const text = userPrompt({
      request: "make it dark",
      snapshot,
      current: { css: "body{color:red}", script: "" },
      hasScreenshot: true,
      references: 0,
    });
    assert.include(text, "<request>\nmake it dark\n</request>");
    assert.include(text, "body{color:red}");
    assert.include(text, "<current_script>\n(empty)\n</current_script>");
    assert.include(text, "Selector: main > h1");
    assert.notInclude(text, "<reference_images>");
  });

  it("says which attached image is the screenshot and which are references", () => {
    const base = { request: "like this", snapshot, current: { css: "", script: "" } };
    assert.include(
      userPrompt({ ...base, hasScreenshot: true, references: 2 }),
      "The first attached image is the screenshot of the page; the next 2 are references",
    );
    assert.include(
      userPrompt({ ...base, hasScreenshot: false, references: 1 }),
      "The attached image is a reference",
    );
  });
});
