import type { ContentEvent, ContentRequest } from "../domain/Messages.ts";
import type { SiteStyle } from "../domain/SiteStyle.ts";
import { siteStyleKey } from "../shared/keys.ts";
import { inspectElements } from "./inspect.ts";
import { startPicker } from "./picker.ts";
import { collectSnapshot, OWN_ATTRIBUTE } from "./snapshot.ts";

// Registered content scripts and on-demand injection can both reach a page.
const marker = "__vibecheckContentScript";
const scope = globalThis as typeof globalThis & { [marker]?: true };

const STYLE_ID = "vibecheck-site-style";
const key = siteStyleKey(location.origin);

// While the model previews a draft, its CSS replaces the Site Style's.
let previewCss: string | null = null;
let lastStyle: SiteStyle | undefined;

/** Shows the current Revision's CSS, or nothing when the Site Style is off. */
const render = (style: SiteStyle | undefined) => {
  lastStyle = style;
  const revision = style?.revisions.find((candidate) => candidate.id === style.currentRevisionId);
  const css = previewCss ?? (style?.enabled && revision ? revision.css : "");
  let element = document.getElementById(STYLE_ID);
  if (!css) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("style");
    element.id = STYLE_ID;
    element.setAttribute(OWN_ATTRIBUTE, "");
  }
  element.textContent = css;
  // Last in the document, so it follows the site's own stylesheets.
  (document.head ?? document.documentElement).append(element);
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Scrolls to `selector` if given, then waits until the page has painted. */
const settle = async (selector: string | null) => {
  let found = true;
  if (selector) {
    const target = document.querySelector(selector);
    found = target !== null;
    target?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  await nextFrame();
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { found };
};

const load = async () => {
  const items = await chrome.storage.local.get(key);
  render(items[key] as SiteStyle | undefined);
};

const main = () => {
  void load();
  // Stylesheets added while the page loads would otherwise come after ours.
  document.addEventListener("DOMContentLoaded", () => void load(), { once: true });

  chrome.storage.local.onChanged.addListener((changes) => {
    const change = changes[key];
    if (change) render(change.newValue as SiteStyle | undefined);
  });

  chrome.runtime.onMessage.addListener((message: ContentRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    switch (message._tag) {
      case "Ping":
        sendResponse(true);
        return false;
      case "CollectSnapshot":
        sendResponse(collectSnapshot(message.selector));
        return false;
      case "StartPicker":
        startPicker((element) => {
          const event: ContentEvent = { _tag: "Picked", element };
          void chrome.runtime.sendMessage(event);
        });
        sendResponse(true);
        return false;
      case "Inspect":
        sendResponse(inspectElements(message.selector));
        return false;
      case "Preview":
        previewCss = message.css;
        render(lastStyle);
        void settle(message.scrollTo).then(sendResponse);
        return true;
      case "ClearPreview":
        previewCss = null;
        render(lastStyle);
        sendResponse(true);
        return false;
    }
  });
};

if (!scope[marker]) {
  scope[marker] = true;
  main();
}
