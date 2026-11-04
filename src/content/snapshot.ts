import type { PageSnapshot } from "../domain/Restyle.ts";

const SKIPPED = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "LINK",
  "META",
  "IFRAME",
  "OBJECT",
]);
const KEPT_ATTRIBUTES = ["role", "aria-label", "type", "name", "placeholder", "data-testid", "alt"];
const MAX_NODES = 1500;
const MAX_DEPTH = 30;
const MAX_CHARS = 40_000;
const SIMILAR_SIBLINGS_SHOWN = 3;
const STYLE_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border-radius",
  "padding",
  "margin",
  "display",
] as const;
const KEY_ELEMENTS = [
  "body",
  "header",
  "nav",
  "main",
  "h1",
  "h2",
  "p",
  "a",
  "button",
  "input",
  "footer",
];

/** Marks vibecheck's own elements so they never end up in a snapshot. */
export const OWN_ATTRIBUTE = "data-vibecheck-ui";

export const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

const ownText = (element: Element) =>
  Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

export const describe = (element: Element) => {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 4)
    .map((name) => `.${name}`)
    .join("");
  const attributes = KEPT_ATTRIBUTES.flatMap((name) => {
    const value = element.getAttribute(name);
    return value ? [`[${name}="${clip(value, 40)}"]`] : [];
  }).join("");
  const href = element instanceof HTMLAnchorElement && element.getAttribute("href") ? "[href]" : "";
  return `${tag}${id}${classes}${attributes}${href}`;
};

const isRendered = (element: Element) =>
  !(element instanceof HTMLElement) || element.checkVisibility();

/** An indented outline of the visible DOM, with repeated siblings collapsed. */
const outline = (root: Element) => {
  const lines: Array<string> = [];
  let nodes = 0;
  let chars = 0;

  const walk = (element: Element, depth: number) => {
    if (nodes >= MAX_NODES || chars >= MAX_CHARS) return;
    nodes += 1;
    const text = clip(ownText(element), 80);
    const line = `${"  ".repeat(depth)}${describe(element)}${text ? ` "${text}"` : ""}`;
    lines.push(line);
    chars += line.length + 1;
    if (depth >= MAX_DEPTH || element.tagName === "svg" || element.tagName === "SELECT") return;

    let previous = "";
    let repeats = 0;
    const flush = () => {
      if (repeats > SIMILAR_SIBLINGS_SHOWN) {
        lines.push(
          `${"  ".repeat(depth + 1)}… ${repeats - SIMILAR_SIBLINGS_SHOWN} more like the above`,
        );
      }
    };
    for (const child of Array.from(element.children)) {
      if (SKIPPED.has(child.tagName) || child.hasAttribute(OWN_ATTRIBUTE) || !isRendered(child))
        continue;
      const signature = describe(child);
      repeats = signature === previous ? repeats + 1 : (flush(), 1);
      previous = signature;
      if (repeats <= SIMILAR_SIBLINGS_SHOWN) walk(child, depth + 1);
    }
    flush();
  };

  walk(root, 0);
  if (nodes >= MAX_NODES || chars >= MAX_CHARS) lines.push("… (outline truncated)");
  return lines.join("\n");
};

/** CSS custom properties declared on :root or html, with their current values. */
const ROOT_SELECTOR = /(^|,)\s*(:root|html)\b/;

const readableRules = (sheet: CSSStyleSheet) => {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    return []; // Cross-origin stylesheets cannot be read.
  }
};

const rootCustomProperties = (rule: CSSRule) =>
  rule instanceof CSSStyleRule && ROOT_SELECTOR.test(rule.selectorText)
    ? Array.from(rule.style).filter((property) => property.startsWith("--"))
    : [];

const designTokens = () => {
  const names = new Set(
    Array.from(document.styleSheets).flatMap((sheet) =>
      readableRules(sheet).flatMap(rootCustomProperties),
    ),
  );
  const computed = getComputedStyle(document.documentElement);
  return Array.from(names)
    .slice(0, 120)
    .map((name) => `${name}: ${computed.getPropertyValue(name).trim()}`)
    .join("\n");
};

export const computedStyles = (element: Element) => {
  const computed = getComputedStyle(element);
  return STYLE_PROPERTIES.map(
    (property) => `${property}: ${computed.getPropertyValue(property)}`,
  ).join("; ");
};

const keyElementStyles = () =>
  KEY_ELEMENTS.flatMap((selector) => {
    const element = document.querySelector(selector);
    return element ? [`${selector}: ${computedStyles(element)}`] : [];
  }).join("\n");

export const collectSnapshot = (selector: string | null): PageSnapshot => {
  const selectedElement = selector ? document.querySelector(selector) : null;
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    outline: document.body ? outline(document.body) : "",
    tokens: designTokens(),
    styles: keyElementStyles(),
    selected:
      selector && selectedElement
        ? {
            selector,
            html: clip(selectedElement.outerHTML, 4000),
            styles: computedStyles(selectedElement),
          }
        : null,
  };
};
