import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeExchangeFile, toExchangeFile } from "./Exchange.ts";
import { appendRevision, emptySiteStyle, restoreRevision } from "./SiteStyle.ts";

const revision = (id: string) => ({
  id,
  createdAt: 0,
  prompt: id,
  summary: id,
  css: `/* ${id} */`,
  script: "",
  model: "m",
});

describe("Exchange", () => {
  it.effect("exports only the current Revision of each site and reads it back", () =>
    Effect.gen(function* () {
      const style = restoreRevision(
        appendRevision(
          appendRevision(emptySiteStyle("https://a.test"), revision("old")),
          revision("new"),
        ),
        "old",
      );
      const empty = emptySiteStyle("https://b.test");
      const file = toExchangeFile([style, empty], new Date("2026-11-04T00:00:00Z"));
      assert.deepStrictEqual(
        file.sites.map((site) => [site.origin, site.prompt]),
        [["https://a.test", "old"]],
      );
      const decoded = yield* decodeExchangeFile(JSON.stringify(file));
      assert.deepStrictEqual(decoded, file);
    }),
  );

  it.effect("rejects files from other tools", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeExchangeFile('{"format":"other","version":1,"sites":[]}'),
      );
      assert.strictEqual(error._tag, "SchemaError");
    }),
  );
});
