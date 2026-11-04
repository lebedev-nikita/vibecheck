import { Schema } from "effect";
import { currentRevision, type SiteStyle } from "./SiteStyle.ts";

/** A shared Site Style: the current Revision of one site, without history. */
export const ExchangedSite = Schema.Struct({
  origin: Schema.String,
  prompt: Schema.String,
  summary: Schema.String,
  css: Schema.String,
  script: Schema.String,
  model: Schema.String,
});

const ExchangeFile = Schema.Struct({
  format: Schema.Literal("vibecheck.site-styles"),
  version: Schema.Literal(1),
  exportedAt: Schema.String,
  sites: Schema.Array(ExchangedSite),
});
export type ExchangeFile = typeof ExchangeFile.Type;

export const toExchangeFile = (styles: ReadonlyArray<SiteStyle>, now: Date): ExchangeFile => ({
  format: "vibecheck.site-styles",
  version: 1,
  exportedAt: now.toISOString(),
  sites: styles.flatMap((style) => {
    const revision = currentRevision(style);
    if (!revision) return [];
    const { prompt, summary, css, script, model } = revision;
    return [{ origin: style.origin, prompt, summary, css, script, model }];
  }),
});

export const decodeExchangeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(ExchangeFile));
