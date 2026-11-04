import { Schema } from "effect";

const REVISION_LIMIT = 20;

const Revision = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.Number,
  prompt: Schema.String,
  summary: Schema.String,
  css: Schema.String,
  script: Schema.String,
  model: Schema.String,
});
export type Revision = typeof Revision.Type;

/** Revisions are stored oldest first; `currentRevisionId` points at the one in effect. */
export const SiteStyle = Schema.Struct({
  origin: Schema.String,
  enabled: Schema.Boolean,
  currentRevisionId: Schema.NullOr(Schema.String),
  revisions: Schema.Array(Revision),
});
export type SiteStyle = typeof SiteStyle.Type;

export const emptySiteStyle = (origin: string): SiteStyle => ({
  origin,
  enabled: true,
  currentRevisionId: null,
  revisions: [],
});

export const currentRevision = (style: SiteStyle | null): Revision | null =>
  style?.revisions.find((revision) => revision.id === style.currentRevisionId) ?? null;

/** Makes `revision` current and drops the oldest revisions beyond the limit. */
export const appendRevision = (
  style: SiteStyle,
  revision: Revision,
  limit: number = REVISION_LIMIT,
): SiteStyle => ({
  ...style,
  enabled: true,
  currentRevisionId: revision.id,
  revisions: [...style.revisions, revision].slice(-limit),
});

export const restoreRevision = (style: SiteStyle, revisionId: string): SiteStyle =>
  style.revisions.some((revision) => revision.id === revisionId)
    ? { ...style, enabled: true, currentRevisionId: revisionId }
    : style;

/** The CSS and Page Script that should be running on the site right now. */
export interface Effective {
  readonly css: string;
  readonly script: string;
}

export const effective = (style: SiteStyle | null): Effective => {
  const revision = currentRevision(style);
  if (!style?.enabled || !revision) return { css: "", script: "" };
  return { css: revision.css, script: revision.script };
};

/**
 * How to bring an open tab from one Site Style to another. CSS updates live;
 * a Page Script cannot be undone, so replacing or removing one needs a reload.
 */
export type Transition =
  | { readonly _tag: "Live"; readonly runScript: string | null }
  | { readonly _tag: "Reload" };

export const transition = (before: Effective, after: Effective): Transition => {
  if (before.script === after.script) return { _tag: "Live", runScript: null };
  if (before.script !== "") return { _tag: "Reload" };
  return { _tag: "Live", runScript: after.script };
};

/** Origins vibecheck can restyle: regular web pages only. */
export const restylableOrigin = (url: string | undefined): string | null => {
  if (!url) return null;
  const parsed = URL.parse(url);
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return null;
  if (parsed.hostname === "chromewebstore.google.com") return null;
  return parsed.origin;
};

export const originPattern = (origin: string) => `${origin}/*`;
