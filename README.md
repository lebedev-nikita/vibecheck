<img src="assets/icon.svg" width="64" height="64" alt="">

# vibecheck

A Chrome extension that restyles any website from a prompt. Open a site, click the vibecheck icon, describe the look you want, and an AI model of your choice rewrites the page's CSS and, when CSS is not enough, adds a small script that moves or rewrites elements. The result is saved per site and applied on every visit.

- **Providers:** Anthropic (API key), OpenAI (API key), ChatGPT (your subscription, through OpenAI's [Sign in with ChatGPT](https://learn.chatgpt.com/siwc)) and any OpenAI-compatible endpoint, such as OpenRouter, Ollama or LM Studio.
- **No server:** requests go straight from your browser to the provider you chose.
- **History:** each site keeps its last 20 Revisions; restore any of them, turn a site's style off, pick an element to restyle just that part, export and import styles.
- **Reference images:** paste (⌘V) or drop images into the prompt to show the look you want.

Claude subscriptions (Pro, Max) cannot be used: Anthropic does not allow third-party apps to sign in with Claude.ai accounts. Use an API key from [console.anthropic.com](https://console.anthropic.com) instead.

## Install from source

Requirements: [mise](https://mise.jdx.dev), [Just](https://just.systems) and the [Vite+](https://viteplus.dev/guide/) CLI (`vp`). `mise install` provides pinned versions of Bun, Just and `vp`.

```sh
just install
just build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist` folder.
3. Open vibecheck's **Details** and turn on **Allow User Scripts**. Without it, vibecheck only changes CSS.
4. Click the vibecheck icon, open settings and add a connection.

Chrome 138 or newer is required.

## Develop

```sh
just dev    # rebuild dist/ on change, then reload the extension in chrome://extensions
just check  # format, lint, type-check
just test   # unit tests
just e2e    # the built extension in Chrome for Testing against a mock provider
just ci     # everything above plus code-health analysis
```

`just package` zips `dist/` for the Chrome Web Store; the listing and privacy answers are in [docs/store-listing.md](docs/store-listing.md).

## How it works

The popup sends a Restyle Request to the service worker: your prompt, an outline of the page, a screenshot of the visible area and the site's current Site Style. The model works as an agent with three tools: it can inspect elements, preview a draft stylesheet on the page and look at its screenshot, and finally submits the complete next CSS and Page Script. Servers without tool support get a single request instead. CSS is injected by a content script; the Page Script runs through Chrome's `userScripts` API in an isolated world without network access. See [GLOSSARY.md](GLOSSARY.md) for the terms and [docs/adr](docs/adr) for the main design decisions.

## Privacy

See [docs/privacy-policy.md](docs/privacy-policy.md).

## License

[MIT](LICENSE)
