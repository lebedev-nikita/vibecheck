# Providers are called directly from the browser

vibecheck calls AI providers from its service worker, with no local host program, CLI or server of its own. A native-messaging host driving the Codex or Claude Code CLIs was considered, but it needs a separate install per machine and cannot ship through the Chrome Web Store, which the extension is meant to reach. The cost: credentials (API keys, ChatGPT tokens) live in the extension's storage, and only providers with a browser-usable API or an official third-party sign-in can be supported.
