# Model calls go through an Effect AI agent

Restyle Requests run as a bounded agent loop on Effect AI (`effect/ai` with `@effect/ai-anthropic`, `@effect/ai-openai` and `@effect/ai-openai-compat`) instead of the official Anthropic and OpenAI SDKs. One Toolkit of Schema-defined tools (inspect, preview, submit) then works over all three protocols the extension speaks — Anthropic Messages, OpenAI Responses and Chat Completions — and fits the project's Effect stack. Full agent harnesses such as the Claude Agent SDK or Codex need a local process, which ADR 0001 rules out.

## Consequences

- Tool results in Chat Completions are text only, so preview screenshots go back to the model as a user turn after the tool results.
- ChatGPT plan usage only accepts function tools grouped in a namespace; a request transform rewrites the Responses body for it.
- A server that rejects the first request with tools gets one request without them, answered as JSON.
