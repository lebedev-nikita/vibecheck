# vibecheck

Chrome MV3 extension; see README.md for what it does, GLOSSARY.md for domain terms and docs/adr for design decisions. Use the glossary's terms (Site Style, Revision, Page Script, Restyle Request, Page Snapshot, Provider, Connection) in code, UI copy and docs.

## Layout

- `src/background/` — service worker (Effect services, ChatGPT sign-in); `agent/` holds the tool-using Effect AI agent and its provider wiring.
- `src/content/` — content script, built as a single classic script by the `content` Vite environment; keep it free of `effect` and other heavy imports.
- `src/popup/`, `src/options/` — React UI. `src/domain/` — Schemas and pure logic. `src/shared/` — storage access shared by all contexts.

## Commands

Run `just` for the recipe list. Before finishing a change, run `just check`, `just test` and, for anything touching the service worker, content script or UI, `just e2e`.

## Constraints

- Chrome Web Store policy: never `eval`, `new Function` or interpret model output as commands; model code runs only through `chrome.userScripts` (ADR 0002).
- `chrome.permissions.request` must be called synchronously inside the click handler, before any `await`.
- Model calls go through Effect AI (`effect/ai` with `@effect/ai-anthropic`, `@effect/ai-openai`, `@effect/ai-openai-compat`); model lists through Effect `HttpClient` (ADR 0004). ChatGPT plan usage needs `store: false`, streaming and tools grouped in a namespace.

# Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
