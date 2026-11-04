import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { ContentEvent, type Reply, Request } from "../domain/Messages.ts";
import {
  appendRevision,
  emptySiteStyle,
  restoreRevision,
  restylableOrigin,
  type SiteStyle,
} from "../domain/SiteStyle.ts";
import * as Storage from "../shared/storage.ts";
import { Agent } from "./agent/Agent.ts";
import { ChatGPTAuth } from "./chatgpt/ChatGPTAuth.ts";
import { CALLBACK_HOST, CALLBACK_PATH, CALLBACK_PORT } from "./chatgpt/oauth.ts";
import { Pages } from "./Pages.ts";
import { Registrations } from "./Registrations.ts";
import { Restyler } from "./Restyler.ts";

const MainLayer = Restyler.layer.pipe(
  Layer.provideMerge(Registrations.layer),
  Layer.provideMerge(Agent.layer),
  Layer.provideMerge(ChatGPTAuth.layer),
  Layer.provideMerge(Pages.layer),
);

const runtime = ManagedRuntime.make(MainLayer);

class BackgroundError extends Schema.TaggedError<BackgroundError>()("BackgroundError", {
  message: Schema.String,
}) {}

/** Applies a change to one stored Site Style and brings the open tab along. */
const updateSiteStyle = Effect.fnUntraced(function* (
  origin: string,
  tabId: number | null,
  change: (style: SiteStyle) => SiteStyle,
) {
  const registrations = yield* Registrations;
  const before = yield* Storage.getSiteStyle(origin);
  if (!before) return;
  const after = change(before);
  yield* Storage.putSiteStyle(after);
  yield* registrations.sync;
  if (tabId !== null) yield* registrations.apply(tabId, before, after);
});

const handle = (request: Request) =>
  Effect.gen(function* () {
    switch (request._tag) {
      case "Restyle":
        return yield* (yield* Restyler).start(request);
      case "CancelRestyle":
        return yield* (yield* Restyler).cancel(request.tabId);
      case "RestoreRevision":
        return yield* updateSiteStyle(request.origin, request.tabId, (style) =>
          restoreRevision(style, request.revisionId),
        );
      case "SetEnabled":
        return yield* updateSiteStyle(request.origin, request.tabId, (style) => ({
          ...style,
          enabled: request.enabled,
        }));
      case "DeleteSiteStyle": {
        yield* Storage.deleteSiteStyle(request.origin);
        return yield* (yield* Registrations).sync;
      }
      case "StartPicker": {
        const pages = yield* Pages;
        yield* pages.ensureContentScript(request.tabId);
        return yield* pages.startPicker(request.tabId);
      }
      case "ListModels":
        return yield* (yield* Agent).listModels(request.connection);
      case "ChatGPTSignIn":
        return yield* (yield* ChatGPTAuth).signIn(request.connectionId);
      case "ChatGPTSignOut":
        return yield* (yield* ChatGPTAuth).signOut(request.connectionId);
      case "ImportSites": {
        for (const site of request.sites) {
          const origin = restylableOrigin(site.origin);
          if (!origin) continue;
          const existing = (yield* Storage.getSiteStyle(origin)) ?? emptySiteStyle(origin);
          yield* Storage.putSiteStyle(
            appendRevision(existing, {
              id: crypto.randomUUID(),
              createdAt: Date.now(),
              prompt: site.prompt,
              summary: site.summary,
              css: site.css,
              script: site.script,
              model: site.model,
            }),
          );
        }
        return yield* (yield* Registrations).sync;
      }
      case "Sync":
        return yield* (yield* Registrations).sync;
    }
  });

const isExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL("")) === true;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // The content script only ever reports a picked element for its own tab.
  const event = Schema.decodeUnknownOption(ContentEvent)(message);
  if (event._tag === "Some") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined)
      void runtime.runPromise(Storage.putPicked(tabId, event.value.element).pipe(Effect.ignore));
    return false;
  }
  if (!isExtensionPage(sender)) return false;

  const program = Schema.decodeUnknownEffect(Request)(message).pipe(
    Effect.mapError(() => new BackgroundError({ message: "Unknown request" })),
    Effect.flatMap(handle),
    Effect.match({
      onSuccess: (value): Reply => ({ _tag: "Ok", value: value ?? null }),
      onFailure: (error): Reply => ({ _tag: "Error", message: error.message }),
    }),
  );
  void runtime.runPromise(program).then(sendResponse);
  return true;
});

const sync = () =>
  void runtime.runPromise(
    Effect.gen(function* () {
      yield* (yield* Registrations).sync;
    }).pipe(Effect.ignore),
  );

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);

chrome.tabs.onRemoved.addListener((tabId) => {
  void runtime.runPromise(
    Effect.all([Storage.clearStatus(tabId), Storage.clearPicked(tabId)]).pipe(Effect.ignore),
  );
});

// The ChatGPT sign-in redirect needs `webNavigation`, which is only requested
// when the user starts a sign-in. Listen as soon as it is granted.
let listeningForSignIn = false;
const listenForSignIn = () => {
  if (listeningForSignIn || !chrome.webNavigation) return;
  listeningForSignIn = true;
  chrome.webNavigation.onBeforeNavigate.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      void runtime.runPromise(
        Effect.gen(function* () {
          yield* (yield* ChatGPTAuth).handleNavigation(details.tabId, details.url);
        }),
      );
    },
    { url: [{ hostEquals: CALLBACK_HOST, ports: [CALLBACK_PORT], pathEquals: CALLBACK_PATH }] },
  );
};
listenForSignIn();
chrome.permissions.onAdded.addListener(listenForSignIn);
