import { Context, Effect, Layer, Schema } from "effect";
import type { ContentRequest } from "../domain/Messages.ts";
import { PageSnapshot } from "../domain/Restyle.ts";
import { downscaleToJpeg } from "../shared/images.ts";

export class PageError extends Schema.TaggedError<PageError>()("PageError", {
  message: Schema.String,
}) {}

const SCREENSHOT_MAX_WIDTH = 1280;

const chromeCall = <A>(message: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new PageError({ message: `${message}: ${String(cause)}` }),
  });

const sendToContent = (tabId: number, request: ContentRequest) =>
  chromeCall("The page did not answer", (): Promise<unknown> =>
    chrome.tabs.sendMessage(tabId, request),
  );

/** Downscales a screenshot so it costs fewer tokens; returns base64 JPEG. */
const shrink = (dataUrl: string) =>
  chromeCall("Could not process the screenshot", async () =>
    downscaleToJpeg(await (await fetch(dataUrl)).blob(), SCREENSHOT_MAX_WIDTH),
  );

const Inspection = Schema.Struct({ ok: Schema.Boolean, text: Schema.String });
const PreviewReply = Schema.Struct({ found: Schema.Boolean });

/** Everything vibecheck does to browser tabs. */
export class Pages extends Context.Service<
  Pages,
  {
    readonly ensureContentScript: (tabId: number) => Effect.Effect<void, PageError>;
    readonly snapshot: (
      tabId: number,
      selector: string | null,
    ) => Effect.Effect<PageSnapshot, PageError>;
    /** The visible area of the tab, provided it is still the one the user is looking at. */
    readonly screenshot: (tabId: number) => Effect.Effect<string, PageError>;
    /** HTML and computed styles of matching elements; fails with a message for the model. */
    readonly inspect: (tabId: number, selector: string) => Effect.Effect<string, PageError>;
    /** Shows draft CSS in place of the Site Style's until `clearPreview`. */
    readonly preview: (
      tabId: number,
      css: string,
      scrollTo: string | null,
    ) => Effect.Effect<{ readonly found: boolean }, PageError>;
    readonly clearPreview: (tabId: number) => Effect.Effect<void>;
    readonly startPicker: (tabId: number) => Effect.Effect<void, PageError>;
    readonly runScript: (tabId: number, code: string) => Effect.Effect<void, PageError>;
    readonly reload: (tabId: number) => Effect.Effect<void, PageError>;
  }
>()("vibecheck/background/Pages") {
  static readonly layer = Layer.succeed(Pages, {
    ensureContentScript: (tabId) =>
      sendToContent(tabId, { _tag: "Ping" }).pipe(
        Effect.catch(() =>
          chromeCall("vibecheck cannot access this page", () =>
            chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }),
          ),
        ),
        Effect.asVoid,
      ),
    snapshot: (tabId, selector) =>
      sendToContent(tabId, { _tag: "CollectSnapshot", selector }).pipe(
        Effect.flatMap((reply) =>
          Schema.decodeUnknownEffect(PageSnapshot)(reply).pipe(
            Effect.mapError(
              () => new PageError({ message: "The page returned an unreadable snapshot" }),
            ),
          ),
        ),
      ),
    screenshot: (tabId) =>
      chromeCall("The tab was closed", () => chrome.tabs.get(tabId)).pipe(
        Effect.flatMap((tab) =>
          // captureVisibleTab shows whatever tab is in front, not necessarily this one.
          tab.active
            ? chromeCall("Could not capture the page", () =>
                chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 }),
              )
            : Effect.fail(new PageError({ message: "The tab is no longer in front" })),
        ),
        Effect.flatMap(shrink),
      ),
    inspect: (tabId, selector) =>
      sendToContent(tabId, { _tag: "Inspect", selector }).pipe(
        Effect.flatMap((reply) =>
          Schema.decodeUnknownEffect(Inspection)(reply).pipe(
            Effect.mapError(
              () => new PageError({ message: "The page returned an unreadable answer" }),
            ),
          ),
        ),
        Effect.flatMap(({ ok, text }) =>
          ok ? Effect.succeed(text) : Effect.fail(new PageError({ message: text })),
        ),
      ),
    preview: (tabId, css, scrollTo) =>
      sendToContent(tabId, { _tag: "Preview", css, scrollTo }).pipe(
        Effect.flatMap((reply) =>
          Schema.decodeUnknownEffect(PreviewReply)(reply).pipe(
            Effect.mapError(
              () => new PageError({ message: "The page returned an unreadable answer" }),
            ),
          ),
        ),
      ),
    clearPreview: (tabId) => sendToContent(tabId, { _tag: "ClearPreview" }).pipe(Effect.ignore),
    startPicker: (tabId) => sendToContent(tabId, { _tag: "StartPicker" }).pipe(Effect.asVoid),
    runScript: (tabId, code) =>
      chromeCall("Could not run the Page Script", () =>
        chrome.userScripts.execute({ target: { tabId }, js: [{ code }] }),
      ).pipe(Effect.asVoid),
    reload: (tabId) => chromeCall("Could not reload the tab", () => chrome.tabs.reload(tabId)),
  });
}
