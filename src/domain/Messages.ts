import { Schema } from "effect";
import { Connection, ModelInfo } from "./Connection.ts";
import { ExchangedSite } from "./Exchange.ts";
import { PickedElement, ReferenceImage } from "./Restyle.ts";

/** Requests extension pages send to the service worker. */
export const Request = Schema.Union([
  Schema.TaggedStruct("Restyle", {
    tabId: Schema.Number,
    prompt: Schema.String,
    connectionId: Schema.String,
    model: Schema.String,
    references: Schema.Array(ReferenceImage),
  }),
  Schema.TaggedStruct("CancelRestyle", { tabId: Schema.Number }),
  Schema.TaggedStruct("RestoreRevision", {
    tabId: Schema.Number,
    origin: Schema.String,
    revisionId: Schema.String,
  }),
  Schema.TaggedStruct("SetEnabled", {
    tabId: Schema.NullOr(Schema.Number),
    origin: Schema.String,
    enabled: Schema.Boolean,
  }),
  Schema.TaggedStruct("DeleteSiteStyle", { origin: Schema.String }),
  Schema.TaggedStruct("StartPicker", { tabId: Schema.Number }),
  Schema.TaggedStruct("ListModels", { connection: Connection }),
  Schema.TaggedStruct("ChatGPTSignIn", { connectionId: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("ChatGPTSignOut", { connectionId: Schema.String }),
  Schema.TaggedStruct("ImportSites", { sites: Schema.Array(ExchangedSite) }),
  Schema.TaggedStruct("Sync", {}),
]);
export type Request = typeof Request.Type;

export const ModelList = Schema.Array(ModelInfo);

export const Reply = Schema.Union([
  Schema.TaggedStruct("Ok", { value: Schema.Unknown }),
  Schema.TaggedStruct("Error", { message: Schema.String }),
]);
export type Reply = typeof Reply.Type;

/** Messages between the service worker and the content script. */
const ContentRequest = Schema.Union([
  Schema.TaggedStruct("Ping", {}),
  Schema.TaggedStruct("CollectSnapshot", { selector: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("StartPicker", {}),
  Schema.TaggedStruct("Inspect", { selector: Schema.String }),
  Schema.TaggedStruct("Preview", { css: Schema.String, scrollTo: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("ClearPreview", {}),
]);
export type ContentRequest = typeof ContentRequest.Type;

export const ContentEvent = Schema.TaggedStruct("Picked", { element: PickedElement });
export type ContentEvent = typeof ContentEvent.Type;
