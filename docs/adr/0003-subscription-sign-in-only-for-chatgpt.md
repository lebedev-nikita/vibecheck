# Subscription sign-in only for ChatGPT, through Sign in with ChatGPT

ChatGPT plans are supported through OpenAI's official Sign in with ChatGPT for open-source apps (dynamic client registration, `api.openai.com/v1/responses`), not by reusing the Codex CLI's OAuth client, which OpenAI does not approve for other apps. Claude subscriptions are not supported at all: Anthropic does not permit third-party apps to offer Claude.ai login or to use Free, Pro or Max credentials, so Claude is API-key only.

## Consequences

- The project must stay open source to use the open-source Sign in with ChatGPT flow; a paid or closed distribution needs OpenAI's commercial program.
- OpenAI only accepts loopback redirects, so the service worker catches the navigation to `http://127.0.0.1:1455/auth/callback` with the optional `webNavigation` permission instead of using `chrome.identity`.
- OpenAI's guidance is to keep tokens out of browser storage; an extension has nowhere else to keep them, so they are stored in `chrome.storage.local`.
