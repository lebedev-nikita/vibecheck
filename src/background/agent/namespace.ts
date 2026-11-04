import { Predicate } from "effect";

/** The namespace vibecheck's tools are grouped under for ChatGPT plan usage. */
const TOOL_NAMESPACE = "vibecheck";

type Json = Record<string, unknown>;

const isFunctionTool = (tool: unknown): tool is Json =>
  Predicate.isObject(tool) && "type" in tool && tool["type"] === "function";

/**
 * Sign in with ChatGPT only accepts function tools grouped in a namespace, and
 * replayed calls must name it. Rewrites a Responses API request body to match.
 * https://learn.chatgpt.com/siwc/token-sharing-open-source/preview-limitations
 */
export const groupToolsInNamespace = (body: Json): Json => {
  const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
  const functions = tools.filter(isFunctionTool);
  if (functions.length === 0) return body;
  const input = body["input"];
  return {
    ...body,
    tools: [
      ...tools.filter((tool) => !isFunctionTool(tool)),
      {
        type: "namespace",
        name: TOOL_NAMESPACE,
        description: "Tools for reading the page and previewing styles.",
        tools: functions.map(({ strict: _strict, ...tool }) => tool),
      },
    ],
    ...(Array.isArray(input)
      ? {
          input: input.map((item: unknown) =>
            Predicate.isObject(item) && "type" in item && item["type"] === "function_call"
              ? { ...item, namespace: TOOL_NAMESPACE }
              : item,
          ),
        }
      : {}),
  };
};
