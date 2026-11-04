import { clip, computedStyles, describe } from "./snapshot.ts";

const MAX_ELEMENTS = 5;
const MAX_HTML = 1500;

export interface Inspection {
  readonly ok: boolean;
  readonly text: string;
}

/** HTML and computed styles of the elements matching `selector`, for the model. */
export const inspectElements = (selector: string): Inspection => {
  let elements: Array<Element>;
  try {
    elements = Array.from(document.querySelectorAll(selector));
  } catch {
    return { ok: false, text: `"${selector}" is not a valid CSS selector.` };
  }
  if (elements.length === 0) return { ok: false, text: `No element matches "${selector}".` };
  const shown = elements
    .slice(0, MAX_ELEMENTS)
    .map((element, index) =>
      [
        `#${index + 1} ${describe(element)}`,
        `Computed styles: ${computedStyles(element)}`,
        `HTML: ${clip(element.outerHTML, MAX_HTML)}`,
      ].join("\n"),
    );
  const count =
    elements.length > MAX_ELEMENTS
      ? `${elements.length} elements match; the first ${MAX_ELEMENTS} are shown.`
      : `${elements.length} ${elements.length === 1 ? "element matches" : "elements match"}.`;
  return { ok: true, text: [count, ...shown].join("\n\n") };
};
