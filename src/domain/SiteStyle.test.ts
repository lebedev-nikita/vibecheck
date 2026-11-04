import { assert, describe, it } from "@effect/vitest";
import {
  appendRevision,
  currentRevision,
  effective,
  emptySiteStyle,
  restoreRevision,
  restylableOrigin,
  type Revision,
  transition,
} from "./SiteStyle.ts";

const revision = (id: string, script = ""): Revision => ({
  id,
  createdAt: 0,
  prompt: `prompt ${id}`,
  summary: "",
  css: `/* ${id} */`,
  script,
  model: "test",
});

describe("SiteStyle", () => {
  it("makes an appended Revision current", () => {
    const style = appendRevision(emptySiteStyle("https://example.com"), revision("a"));
    assert.strictEqual(currentRevision(style)?.id, "a");
  });

  it("keeps only the newest Revisions", () => {
    let style = emptySiteStyle("https://example.com");
    for (const id of ["a", "b", "c", "d"]) style = appendRevision(style, revision(id), 3);
    assert.deepStrictEqual(
      style.revisions.map((item) => item.id),
      ["b", "c", "d"],
    );
    assert.strictEqual(style.currentRevisionId, "d");
  });

  it("restores an earlier Revision without dropping later ones", () => {
    const style = appendRevision(
      appendRevision(emptySiteStyle("https://example.com"), revision("a")),
      revision("b"),
    );
    const restored = restoreRevision(style, "a");
    assert.strictEqual(restored.currentRevisionId, "a");
    assert.strictEqual(restored.revisions.length, 2);
    assert.strictEqual(restoreRevision(style, "missing"), style);
  });

  it("applies nothing while the Site Style is off", () => {
    const style = appendRevision(emptySiteStyle("https://example.com"), revision("a", "run()"));
    assert.deepStrictEqual(effective({ ...style, enabled: false }), { css: "", script: "" });
    assert.deepStrictEqual(effective(style), { css: "/* a */", script: "run()" });
  });
});

describe("transition", () => {
  it("updates CSS live when the script is unchanged", () => {
    assert.deepStrictEqual(transition({ css: "a", script: "" }, { css: "b", script: "" }), {
      _tag: "Live",
      runScript: null,
    });
  });

  it("runs a new script live when none ran before", () => {
    assert.deepStrictEqual(transition({ css: "", script: "" }, { css: "", script: "x()" }), {
      _tag: "Live",
      runScript: "x()",
    });
  });

  it("reloads when a running script changes or goes away", () => {
    assert.deepStrictEqual(transition({ css: "", script: "x()" }, { css: "", script: "y()" }), {
      _tag: "Reload",
    });
    assert.deepStrictEqual(transition({ css: "", script: "x()" }, { css: "", script: "" }), {
      _tag: "Reload",
    });
  });
});

describe("restylableOrigin", () => {
  it("accepts web pages only", () => {
    assert.strictEqual(restylableOrigin("https://example.com/a?b"), "https://example.com");
    assert.strictEqual(restylableOrigin("http://localhost:3000/"), "http://localhost:3000");
    assert.isNull(restylableOrigin("chrome://extensions"));
    assert.isNull(restylableOrigin("https://chromewebstore.google.com/detail/x"));
    assert.isNull(restylableOrigin(undefined));
  });
});
