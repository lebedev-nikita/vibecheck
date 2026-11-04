import { Context, Effect, Layer, Semaphore } from "effect";
import {
  effective,
  type Effective,
  originPattern,
  type SiteStyle,
  transition,
} from "../domain/SiteStyle.ts";
import * as Storage from "../shared/storage.ts";
import { Pages, type PageError } from "./Pages.ts";

const CONTENT_SCRIPT_ID = "vibecheck-site-style";
const BROAD_PATTERNS = new Set(["*://*/*", "<all_urls>", "https://*/*"]);

// Page Scripts may change the DOM but must not talk to the network, so a page
// that talks the model into exfiltrating data has no channel to do it.
const PAGE_SCRIPT_CSP =
  "script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'";

export const userScriptsAvailable = Effect.promise(async () => {
  try {
    await chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
});

const wrapPageScript = (origin: string, script: string) =>
  `// vibecheck Page Script for ${origin}
(() => {
  try {
${script}
  } catch (error) {
    console.error("[vibecheck] Page Script failed", error);
  }
})();`;

/** What should run on a site, given whether Page Scripts are allowed. */
export const effectiveFor = (style: SiteStyle | null, scriptsAvailable: boolean): Effective => {
  const value = effective(style);
  return scriptsAvailable ? value : { ...value, script: "" };
};

const permittedOrigins = Effect.promise(() => chrome.permissions.getAll()).pipe(
  Effect.map(({ origins = [] }) => {
    const granted = new Set(origins);
    const broad = origins.some((pattern) => BROAD_PATTERNS.has(pattern));
    return (origin: string) => broad || granted.has(originPattern(origin));
  }),
);

const syncContentScript = (matches: Array<string>) =>
  Effect.promise(async () => {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    });
    if (matches.length === 0) {
      if (existing.length > 0)
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
      return;
    }
    if (existing.length > 0) {
      await chrome.scripting.updateContentScripts([
        { id: CONTENT_SCRIPT_ID, matches, js: ["content.js"] },
      ]);
      return;
    }
    await chrome.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        matches,
        js: ["content.js"],
        runAt: "document_start",
        persistAcrossSessions: true,
      },
    ]);
  });

const syncPageScripts = (styles: ReadonlyArray<SiteStyle>) =>
  Effect.promise(async () => {
    await chrome.userScripts.configureWorld({ csp: PAGE_SCRIPT_CSP, messaging: false });
    await chrome.userScripts.unregister();
    const scripts = styles.flatMap((style): Array<chrome.userScripts.RegisteredUserScript> => {
      const { script } = effective(style);
      if (!script) return [];
      return [
        {
          id: `page-script:${style.origin}`,
          matches: [originPattern(style.origin)],
          js: [{ code: wrapPageScript(style.origin, script) }],
          runAt: "document_idle",
          world: "USER_SCRIPT",
        },
      ];
    });
    if (scripts.length > 0) await chrome.userScripts.register(scripts);
  });

/**
 * Keeps the browser's registered content and user scripts in line with the
 * stored Site Styles, so styles apply on their own on every visit.
 */
export class Registrations extends Context.Service<
  Registrations,
  {
    readonly sync: Effect.Effect<void, Storage.StorageError>;
    readonly apply: (
      tabId: number,
      before: SiteStyle | null,
      after: SiteStyle | null,
    ) => Effect.Effect<void, PageError>;
  }
>()("vibecheck/background/Registrations") {
  static readonly layer = Layer.effect(
    Registrations,
    Effect.gen(function* () {
      const pages = yield* Pages;
      const lock = yield* Semaphore.make(1);

      const sync = lock
        .withPermit(
          Effect.gen(function* () {
            const isPermitted = yield* permittedOrigins;
            const styles = (yield* Storage.listSiteStyles).filter((style) =>
              isPermitted(style.origin),
            );
            yield* syncContentScript(styles.map((style) => originPattern(style.origin)));
            if (yield* userScriptsAvailable) yield* syncPageScripts(styles);
          }),
        )
        .pipe(Effect.withSpan("Registrations.sync"));

      const apply = Effect.fn("Registrations.apply")(function* (
        tabId: number,
        before: SiteStyle | null,
        after: SiteStyle | null,
      ) {
        const scripts = yield* userScriptsAvailable;
        const next = transition(effectiveFor(before, scripts), effectiveFor(after, scripts));
        if (next._tag === "Reload") return yield* pages.reload(tabId);
        // The content script reads the stored Site Style, so CSS follows on its own.
        yield* pages.ensureContentScript(tabId);
        if (next.runScript && after)
          yield* pages.runScript(tabId, wrapPageScript(after.origin, next.runScript));
      });

      return Registrations.of({ sync, apply });
    }),
  );
}
