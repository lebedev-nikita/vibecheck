import { Schema } from "effect";

export const PickedElement = Schema.Struct({
  selector: Schema.String,
  description: Schema.String,
});
export type PickedElement = typeof PickedElement.Type;

export const PageSnapshot = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  viewport: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  outline: Schema.String,
  tokens: Schema.String,
  styles: Schema.String,
  selected: Schema.NullOr(
    Schema.Struct({ selector: Schema.String, html: Schema.String, styles: Schema.String }),
  ),
});
export type PageSnapshot = typeof PageSnapshot.Type;

/** An image the user attaches to a prompt as visual direction. */
export const ReferenceImage = Schema.Struct({
  /** Base64-encoded JPEG. */
  data: Schema.String,
});
export type ReferenceImage = typeof ReferenceImage.Type;

export const MAX_REFERENCE_IMAGES = 4;

/** What the AI model returns: the complete next Site Style plus a summary. */
export const RestyleResult = Schema.Struct({
  summary: Schema.String,
  css: Schema.String,
  script: Schema.String,
});
export type RestyleResult = typeof RestyleResult.Type;

export const RestyleStatus = Schema.Union([
  Schema.TaggedStruct("Running", {
    prompt: Schema.String,
    startedAt: Schema.Number,
    /** What the agent is doing right now, e.g. "Inspecting nav a". */
    activity: Schema.String,
  }),
  Schema.TaggedStruct("Failed", { prompt: Schema.String, message: Schema.String }),
  Schema.TaggedStruct("Done", { summary: Schema.String }),
]);
export type RestyleStatus = typeof RestyleStatus.Type;
