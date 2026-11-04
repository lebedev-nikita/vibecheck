// Renders assets/icon.svg into the PNG sizes the manifest and Chrome Web Store use.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync("assets/icon.svg", "utf8");

// Toolbar sizes use the artwork as drawn. The store icon keeps its tile at
// 96 of 128 pixels, with the transparent margin Chrome Web Store asks for.
const STORE_SCALE = 96 / 112;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  const scale = size === 128 ? STORE_SCALE : 1;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
        <div style="width:${size * scale}px;height:${size * scale}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
      </div></body></html>`,
  );
  await page.screenshot({ path: `public/icons/${size}.png`, omitBackground: true });
}
await browser.close();
