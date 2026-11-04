import { assert, describe, it } from "@effect/vitest";
import { groupToolsInNamespace } from "./namespace.ts";

describe("groupToolsInNamespace", () => {
  it("groups function tools and tags replayed calls", () => {
    const body = {
      model: "gpt-6.1-sol",
      tools: [
        { type: "function", name: "inspect", parameters: {}, strict: true },
        { type: "web_search" },
      ],
      input: [
        { role: "user", content: "hi" },
        { type: "function_call", call_id: "c1", name: "inspect", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    };
    assert.deepStrictEqual(groupToolsInNamespace(body), {
      model: "gpt-6.1-sol",
      tools: [
        { type: "web_search" },
        {
          type: "namespace",
          name: "vibecheck",
          description: "Tools for reading the page and previewing styles.",
          tools: [{ type: "function", name: "inspect", parameters: {} }],
        },
      ],
      input: [
        { role: "user", content: "hi" },
        {
          type: "function_call",
          call_id: "c1",
          name: "inspect",
          arguments: "{}",
          namespace: "vibecheck",
        },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    });
  });

  it("leaves requests without function tools alone", () => {
    const body = { model: "m", input: "hello" };
    assert.strictEqual(groupToolsInNamespace(body), body);
  });
});
