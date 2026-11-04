import type { PickedElement } from "../domain/Restyle.ts";
import { OWN_ATTRIBUTE } from "./snapshot.ts";

// Ids and classes that look machine-generated make brittle selectors.
const GENERATED = /(^|[-_])[a-z]*\d[a-z\d]{3,}$|^css-|^sc-|^_/i;

const stableClasses = (element: Element) =>
  Array.from(element.classList)
    .filter((name) => !GENERATED.test(name))
    .slice(0, 2);

const isUnique = (selector: string) => {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
};

/** A short CSS selector that matches only `target`. */
const selectorFor = (target: Element): string => {
  const parts: Array<string> = [];
  for (
    let element: Element | null = target;
    element && element !== document.documentElement;
    element = element.parentElement
  ) {
    if (element.id && !GENERATED.test(element.id)) {
      parts.unshift(`#${CSS.escape(element.id)}`);
      break;
    }
    let part =
      element.tagName.toLowerCase() +
      stableClasses(element)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
    const parent: Element | null = element.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === element?.tagName,
      );
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(element) + 1})`;
    }
    parts.unshift(part);
    if (isUnique(parts.join(" > "))) break;
  }
  return parts.join(" > ");
};

const describeTarget = (element: Element) => {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const tag = element.tagName.toLowerCase();
  return text ? `${tag} “${text.length > 40 ? `${text.slice(0, 40)}…` : text}”` : tag;
};

const overlayStyle = (element: HTMLElement, css: Partial<CSSStyleDeclaration>) => {
  element.setAttribute(OWN_ATTRIBUTE, "");
  Object.assign(
    element.style,
    { position: "fixed", zIndex: "2147483647", pointerEvents: "none" },
    css,
  );
  return element;
};

type Stop = () => void;
let active: Stop | null = null;

/** Lets the user click one element; reports it to the service worker. */
export const startPicker = (onPicked: (element: PickedElement) => void) => {
  active?.();

  const highlight = overlayStyle(document.createElement("div"), {
    border: "2px solid #c026d3",
    background: "rgba(192, 38, 211, 0.12)",
    borderRadius: "4px",
    transition: "all 60ms ease-out",
  });
  const banner = overlayStyle(document.createElement("div"), {
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "#18181b",
    color: "#fafafa",
    font: "500 13px/1.4 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
  });
  banner.textContent = "vibecheck: click an element to restyle it · Esc to cancel";
  document.documentElement.append(highlight, banner);

  let hovered: Element | null = null;
  const onMove = (event: MouseEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target === hovered || target.hasAttribute(OWN_ATTRIBUTE)) return;
    hovered = target;
    const rect = target.getBoundingClientRect();
    Object.assign(highlight.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent) => {
    swallow(event);
    const target = hovered ?? document.elementFromPoint(event.clientX, event.clientY);
    stop();
    if (target) onPicked({ selector: selectorFor(target), description: describeTarget(target) });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    swallow(event);
    stop();
  };

  const stop = () => {
    removeEventListener("mousemove", onMove, true);
    removeEventListener("click", onClick, true);
    removeEventListener("mousedown", swallow, true);
    removeEventListener("mouseup", swallow, true);
    removeEventListener("keydown", onKey, true);
    highlight.remove();
    banner.remove();
    active = null;
  };

  addEventListener("mousemove", onMove, true);
  addEventListener("click", onClick, true);
  addEventListener("mousedown", swallow, true);
  addEventListener("mouseup", swallow, true);
  addEventListener("keydown", onKey, true);
  active = stop;
};
