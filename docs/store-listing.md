# Chrome Web Store listing

The text submitted with each release. Keep it in step with the extension; screenshots come from a real restyle of a demo page.

## Store listing

**Summary** (from `manifest.json`): Restyle any website with a prompt, using the AI provider you choose.

**Category:** Tools. **Language:** English.

**Description:**

> vibecheck restyles any website from a sentence. Open a site, click the vibecheck icon and describe the look you want, such as "calm dark theme with a serif headline" or "turn the menu into a grid of cards". An AI model rewrites the page's CSS and, when CSS is not enough, adds a small script that moves or rewrites elements. The result is saved for that site and applied every time you visit.
>
> How it works
> • The model sees an outline of the page and a screenshot of what you see.
> • It can inspect elements and preview its draft on the page before it finishes, so it checks contrast and layout itself.
> • Pick an element to restyle just that part, or paste a reference image to show the look you want.
> • Every site keeps its last 20 versions: roll back, turn a style off, export and import styles.
>
> Bring your own AI
> • Anthropic or OpenAI with an API key, your ChatGPT plan through Sign in with ChatGPT, or any OpenAI-compatible endpoint such as OpenRouter, Ollama or LM Studio.
> • vibecheck has no server. Requests go straight from your browser to the provider you choose.
>
> Privacy and safety
> • vibecheck collects nothing. Page content goes only to your chosen provider, and only when you click Restyle.
> • Scripts written by the model run in an isolated world without network access.
> • Site access is requested per site.
>
> Scripts need "Allow User Scripts" turned on for vibecheck in chrome://extensions; without it vibecheck changes CSS only.
>
> Open source: https://github.com/lebedev-nikita/vibecheck

## Privacy practices

**Single purpose:** Restyle websites according to the user's text prompt by generating CSS and page scripts with an AI model the user chooses.

**Permission justifications:**

| Permission                 | Justification                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                  | Stores the user's connections, settings and per-site styles locally.                                                                                                                                                                                                                             |
| `unlimitedStorage`         | Each site keeps up to 20 versions of full stylesheets and scripts, which can exceed the default quota.                                                                                                                                                                                           |
| `activeTab`                | When the user clicks Restyle, reads the current page's structure and captures the visible area so the model can see the page.                                                                                                                                                                    |
| `scripting`                | Injects the content script that applies saved CSS, collects the page outline, previews drafts and runs the element picker.                                                                                                                                                                       |
| `userScripts`              | Runs the page scripts the AI writes at the user's request, for changes CSS cannot make, through the User Scripts API in an isolated world without network access.                                                                                                                                |
| `webNavigation` (optional) | Requested only for Sign in with ChatGPT, to catch the OAuth redirect to the loopback address OpenAI requires.                                                                                                                                                                                    |
| Host permissions           | `api.anthropic.com`, `api.openai.com` and `auth.openai.com`: calls the provider the user configured and completes Sign in with ChatGPT. Optional `*://*/*`: requested per site when the user first restyles it, so its style applies on later visits, and per custom OpenAI-compatible endpoint. |

**Remote code:** Yes. The extension runs JavaScript that the user's chosen AI model writes in response to the user's prompt. It runs only through `chrome.userScripts` in the `USER_SCRIPT` world, whose content security policy blocks network access. No code is fetched from the developer.

**Data usage:** Website content and authentication information. Page content, the prompt and screenshots are sent to the AI provider the user configured, only when the user clicks Restyle; API keys and ChatGPT tokens are stored locally and sent only to their provider. Nothing is sold, used for unrelated purposes or used to determine creditworthiness.

**Privacy policy:** https://github.com/lebedev-nikita/vibecheck/blob/main/docs/privacy-policy.md
