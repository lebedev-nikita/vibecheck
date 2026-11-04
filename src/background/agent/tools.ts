import { Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";

export const MAX_PREVIEWS = 3;

const Inspect = Tool.make("inspect", {
  description:
    "Read the HTML and computed styles of up to 5 page elements matching a CSS selector. Use it for details the outline leaves out.",
  parameters: Schema.Struct({
    selector: Schema.String.annotate({
      description: "A CSS selector, for example `header nav a`.",
    }),
  }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
});

const Preview = Tool.make("preview", {
  description: `Apply draft CSS to the page in place of the current Site Style CSS and receive a screenshot of the visible area in the next message. Optionally scroll an element into view first. Page Scripts cannot be previewed. At most ${MAX_PREVIEWS} previews.`,
  parameters: Schema.Struct({
    css: Schema.String.annotate({ description: "The complete draft stylesheet." }),
    scroll_to: Schema.NullOr(Schema.String).annotate({
      description: "A CSS selector to scroll into view before the screenshot, or null.",
    }),
  }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
});

const SubmitSiteStyle = Tool.make("submit_site_style", {
  description: "Finish by submitting the complete next Site Style. Call it exactly once, last.",
  parameters: Schema.Struct({
    summary: Schema.String.annotate({
      description: "One or two sentences, in the language of the request, on what changed.",
    }),
    css: Schema.String.annotate({ description: "The complete stylesheet for the site." }),
    script: Schema.String.annotate({
      description: 'The complete Page Script for the site, or "" when CSS is enough.',
    }),
  }),
  success: Schema.String,
});

export const RestyleTools = Toolkit.make(Inspect, Preview, SubmitSiteStyle);
