// End-to-end check of the built extension in Chrome for Testing, against a
// local OpenAI-compatible mock provider. Run with `just e2e` after `just build`.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page, type Worker } from "playwright";

const HEADED = process.env["HEADED"] === "1";

const PAGE = `<!doctype html>
<html><head><title>Mock shop</title><style>:root{--brand:#0055ff} body{font-family:serif}</style></head>
<body><header><nav><a href="/">Home</a></nav></header>
<main><h1 id="title">Mock shop</h1><button class="buy">Buy now</button>
<ul>${Array.from({ length: 12 }, (_, i) => `<li class="item">Item ${i}</li>`).join("")}</ul></main>
</body></html>`;

interface Received {
  readonly text: string;
  /** Images in the first user message: the screenshot and Reference Images. */
  readonly images: number;
  readonly tools: boolean;
  readonly toolResults: Array<string>;
  /** Images sent after the first user message, i.e. preview screenshots. */
  readonly laterImages: number;
}
const received: Array<Received> = [];
const leaks: Array<string> = [];

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => resolve(body));
  });

const server = createServer(async (request, response) => {
  const url = request.url ?? "/";
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "*");
  if (request.method === "OPTIONS") return response.end();
  if (url.startsWith("/leak")) {
    leaks.push(url);
    return response.end("leaked");
  }
  if (url === "/v1/models") {
    response.setHeader("content-type", "application/json");
    return response.end(
      JSON.stringify({
        object: "list",
        data: ["mock-model", "gpt-image-2", "another-model"].map((id) => ({
          id,
          object: "model",
          created: 0,
          owned_by: "test",
        })),
      }),
    );
  }
  if (url === "/v1/chat/completions") {
    const body = JSON.parse(await readBody(request)) as {
      tools?: Array<unknown>;
      messages: Array<{
        role: string;
        content: string | null | Array<{ type: string; text?: string }>;
      }>;
    };
    const partsOf = (message: (typeof body.messages)[number] | undefined) =>
      typeof message?.content === "string"
        ? [{ type: "text", text: message.content }]
        : (message?.content ?? []);
    const firstUser = partsOf(body.messages.find((message) => message.role === "user"));
    const text = firstUser.map((part) => part.text ?? "").join("");
    const toolResults = body.messages.filter((message) => message.role === "tool");
    received.push({
      text,
      images: firstUser.filter((part) => part.type === "image_url").length,
      tools: body.tools !== undefined,
      toolResults: toolResults.map((message) =>
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      ),
      laterImages: body.messages
        .slice(body.messages.findIndex((message) => message.role === "user") + 1)
        .flatMap(partsOf)
        .filter((part) => part.type === "image_url").length,
    });
    const second = text.includes("second pass");
    // The second pass plays a server without tool support, to exercise the fallback.
    if (second && body.tools) {
      response.statusCode = 400;
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ error: { message: "tools are not supported" } }));
    }
    const siteStyle = second
      ? {
          summary: "Second pass.",
          css: "body { background: rgb(4, 5, 6) !important; }",
          script: "document.body.dataset.vibecheck = 'two';",
        }
      : {
          summary: "Made it dark.",
          css: "body { background: rgb(1, 2, 3) !important; }",
          script: `document.body.dataset.vibecheck = 'one';
fetch('http://127.0.0.1:${port}/leak').catch(() => { document.body.dataset.leak = 'blocked'; });`,
        };
    response.setHeader("content-type", "text/event-stream");
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "mock-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    if (!body.tools) {
      // Without tools the model writes the Site Style as JSON, split to exercise streaming.
      const content = JSON.stringify(siteStyle);
      response.write(chunk({ role: "assistant", content: content.slice(0, 20) }, null));
      response.write(chunk({ content: content.slice(20) }, null));
      response.write(chunk({}, "stop"));
      return response.end("data: [DONE]\n\n");
    }
    // With tools the mock agent inspects, previews once, then submits.
    const [name, args] =
      toolResults.length === 0
        ? ["inspect", { selector: "h1#title" }]
        : toolResults.length === 1
          ? ["preview", { css: "h1 { outline: 3px solid rgb(9, 9, 9); }", scroll_to: "button.buy" }]
          : ["submit_site_style", siteStyle];
    await new Promise((resolve) => setTimeout(resolve, 300));
    const call = { index: 0, id: `call_${toolResults.length}`, type: "function" };
    const encoded = JSON.stringify(args);
    response.write(
      chunk(
        {
          role: "assistant",
          tool_calls: [{ ...call, function: { name, arguments: encoded.slice(0, 10) } }],
        },
        null,
      ),
    );
    response.write(
      chunk({ tool_calls: [{ index: 0, function: { arguments: encoded.slice(10) } }] }, null),
    );
    response.write(chunk({}, "tool_calls"));
    return response.end("data: [DONE]\n\n");
  }
  response.setHeader("content-type", "text/html");
  response.end(PAGE);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const origin = `http://127.0.0.1:${port}`;

// Site access is normally asked for at runtime, and screenshots rely on the
// activeTab grant from a real click. Automation can do neither, so the test
// copy of the extension gets broad host access up front.
const extensionDir = mkdtempSync(join(tmpdir(), "vibecheck-ext-"));
cpSync("dist", extensionDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8")) as {
  host_permissions: Array<string>;
};
manifest.host_permissions.push("<all_urls>");
writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest));
const profileDir = mkdtempSync(join(tmpdir(), "vibecheck-profile-"));

const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
  channel: "chromium",
  headless: !HEADED,
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

const step = async (name: string, run: () => Promise<void>) => {
  process.stdout.write(`• ${name} … `);
  await run();
  process.stdout.write("ok\n");
};

const until = async <A>(
  read: () => Promise<A>,
  accept: (value: A) => boolean,
  what: string,
  timeout = 15_000,
) => {
  const start = Date.now();
  let value = await read();
  while (!accept(value)) {
    if (Date.now() - start > timeout)
      assert.fail(`Timed out waiting for ${what}; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    value = await read();
  }
  return value;
};

try {
  const worker: Worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const extensionUrl = (path: string) => `chrome-extension://${id}/${path}`;

  await step("turn on Allow User Scripts", async () => {
    const page = await context.newPage();
    await page.goto(`chrome://extensions/?id=${id}`);
    await page.locator("#allow-user-scripts").click();
    await until(
      () =>
        worker.evaluate(async () =>
          chrome.userScripts.getScripts().then(
            () => true,
            () => false,
          ),
        ),
      Boolean,
      "user scripts",
    );
    await page.close();
  });

  let options!: Page;
  let connection = "";
  await step("add an OpenAI-compatible connection in settings", async () => {
    options = await context.newPage();
    await options.goto(extensionUrl("options/index.html"));
    await options.getByRole("combobox", { name: "Provider" }).click();
    await options.getByRole("option", { name: /OpenAI-compatible/ }).click();
    // A bare host, as CLIProxy and Ollama are usually given, gets /v1 appended.
    await options.getByPlaceholder("http://localhost:11434").fill(origin);
    await options.getByRole("button", { name: "Save connection" }).click();
    await options.getByText(`OpenAI-compatible · ${origin}/v1`).waitFor();
    await options.getByText("Choose one before restyling.").waitFor();
  });

  await step("choose the model after saving, filtering by part of its name", async () => {
    const picker = options.getByRole("combobox", { name: "Model", exact: true });
    await picker.click();
    await options.getByRole("option", { name: "mock-model" }).waitFor();
    assert.deepEqual(
      await options.getByRole("option").allTextContents(),
      ["another-model", "mock-model"],
      "image models are hidden, the rest sorted",
    );
    await picker.fill("ock");
    await until(
      () => options.getByRole("option").allTextContents(),
      (listed) => listed.length === 1 && listed[0] === "mock-model",
      "the list to filter",
    );
    await options.getByRole("option", { name: "mock-model" }).click();
    assert.equal(await picker.inputValue(), "mock-model");
    await until(
      () =>
        worker.evaluate(async () => {
          const { connections } = (await chrome.storage.local.get("connections")) as {
            connections: Array<{ model: string }>;
          };
          return connections[0]?.model;
        }),
      (model) => model === "mock-model",
      "the chosen model to be saved",
    );
  });

  const site = await context.newPage();
  await site.goto(`${origin}/shop`);
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id ?? -1,
    origin,
  );

  const send = (request: object) =>
    options.evaluate((message) => chrome.runtime.sendMessage(message), request);
  const status = () =>
    worker.evaluate(
      async (key) => (await chrome.storage.session.get(key))[key] as { _tag: string } | undefined,
      `status:${tabId}`,
    );
  // Reloads triggered by the extension can land mid-read; report those as "loading".
  const bodyState = () =>
    site
      .evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        marker: document.body.dataset["vibecheck"] ?? null,
        leak: document.body.dataset["leak"] ?? null,
      }))
      .catch(() => ({ background: "loading", marker: "loading", leak: null }));

  // Record every activity the agent reports; they change faster than polling could see.
  await worker.evaluate((key) => {
    const scope = globalThis as typeof globalThis & { activities?: Array<string> };
    scope.activities = [];
    chrome.storage.session.onChanged.addListener((changes) => {
      const value = changes[key]?.newValue as { _tag?: string; activity?: string } | undefined;
      if (value?._tag === "Running" && value.activity) scope.activities?.push(value.activity);
    });
  }, `status:${tabId}`);
  const recordedActivities = () =>
    worker.evaluate(
      () => (globalThis as typeof globalThis & { activities?: Array<string> }).activities ?? [],
    );

  await step("the popup shows the site and starts a restyle with a pasted image", async () => {
    await site.bringToFront();
    await worker.evaluate(() => chrome.action.openPopup());
    // Playwright does not expose extension popups as pages, so drive it over CDP.
    const cdp = await context.newCDPSession(site);
    const { targetInfos } = await until(
      () => cdp.send("Target.getTargets"),
      ({ targetInfos }) => targetInfos.some((target) => target.url.includes("popup/index.html")),
      "the popup",
    );
    const popup = targetInfos.find((target) => target.url.includes("popup/index.html"))!;
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: popup.targetId,
      flatten: false,
    });
    let nextId = 0;
    const evaluate = (expression: string) =>
      new Promise<string>((resolve) => {
        const id = ++nextId;
        const onMessage = (event: { message: string }) => {
          const message = JSON.parse(event.message) as {
            id?: number;
            result?: { result?: { value?: string } };
          };
          if (message.id !== id) return;
          cdp.off("Target.receivedMessageFromTarget", onMessage);
          resolve(message.result?.result?.value ?? "");
        };
        cdp.on("Target.receivedMessageFromTarget", onMessage);
        void cdp.send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, returnByValue: true },
          }),
        });
      });
    const text = await until(
      () => evaluate("document.body.innerText"),
      (value) => value.includes("Restyle"),
      "the popup to render",
    );
    assert.match(text, new RegExp(`127\\.0\\.0\\.1:${port}`), "the popup names the site");
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label="Model"]').value`),
      "mock-model",
      "the popup shows the connection's model",
    );
    assert.match(text, /sent to OpenAI-compatible/, "the popup says where data goes");
    await evaluate(`(() => {
      const prompt = document.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(prompt, "make it dark");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    // Paste a reference image from the clipboard into the prompt.
    await evaluate(`(async () => {
      const canvas = new OffscreenCanvas(64, 48);
      const context = canvas.getContext("2d");
      context.fillStyle = "#123456";
      context.fillRect(0, 0, 64, 48);
      const png = await canvas.convertToBlob({ type: "image/png" });
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([png], "reference.png", { type: "image/png" }));
      document.querySelector("textarea").dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true }),
      );
    })()`);
    await until(
      () =>
        evaluate(`String(document.querySelectorAll('[aria-label="Attached images"] img').length)`),
      (count) => count === "1",
      "the pasted image to appear",
    );
    await evaluate(
      `[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Restyle")).click()`,
    );
    await until(
      () => evaluate("document.body.innerText"),
      (value) => value.includes("Made it dark."),
      "the popup to report the result",
    );
    await cdp.send("Target.closeTarget", { targetId: popup.targetId });
    await cdp.detach();
  });

  await step("the restyle applied CSS and the Page Script live", async () => {
    const connectionId = await worker.evaluate(async () => {
      const { connections } = (await chrome.storage.local.get("connections")) as {
        connections: Array<{ id: string }>;
      };
      return connections[0]!.id;
    });
    await until(status, (value) => value?._tag === "Done", "the status to finish");
    const activities = new Set(await recordedActivities());
    const state = await until(bodyState, (value) => value.marker === "one", "the Page Script");
    assert.equal(state.background, "rgb(1, 2, 3)");
    const turns = received.filter((turn) => turn.text.includes("make it dark"));
    assert.equal(turns.length, 3, "the agent inspects, previews and submits in three turns");
    const [request, , last] = turns as [Received, Received, Received];
    assert.ok(request.tools, "the agent offers tools");
    assert.match(
      last.toolResults[0] ?? "",
      /h1#title[\s\S]*Mock shop/,
      "inspect returns the element",
    );
    assert.match(last.toolResults[1] ?? "", /screenshot follows/, "preview reports its screenshot");
    assert.equal(last.laterImages, 1, "the preview screenshot is sent to the model");
    assert.ok(activities.has("Inspecting h1#title"), `activities: ${[...activities].join(", ")}`);
    assert.ok(activities.has("Previewing draft 1"), `activities: ${[...activities].join(", ")}`);
    assert.equal(
      await site.evaluate(() => getComputedStyle(document.querySelector("h1")!).outlineStyle),
      "none",
      "the preview is removed once the Site Style is saved",
    );
    assert.match(request.text, /<request>\nmake it dark\n<\/request>/);
    assert.match(request.text, /h1#title "Mock shop"/, "the outline names the heading");
    assert.match(request.text, /--brand: #0055ff/, "design tokens are included");
    assert.match(request.text, /… \d+ more like the above/, "repeated siblings are collapsed");
    assert.equal(request.images, 2, "the screenshot and the pasted reference are attached");
    assert.match(request.text, /<reference_images>\nThe first attached image is the screenshot/);
    connection = connectionId;
  });

  await step("Page Scripts cannot reach the network", async () => {
    await until(bodyState, (value) => value.leak === "blocked", "the blocked fetch");
    assert.deepEqual(leaks, []);
  });

  await step("the Site Style applies again after a reload", async () => {
    await site.reload();
    const state = await until(
      bodyState,
      (value) => value.marker === "one",
      "the registered Page Script",
    );
    assert.equal(state.background, "rgb(1, 2, 3)");
  });

  await step(
    "a second Revision, without tool support, replaces the script by reloading the tab",
    async () => {
      await send({
        _tag: "Restyle",
        tabId,
        prompt: "second pass",
        connectionId: connection,
        model: "mock-model",
        references: [],
      });
      const state = await until(
        bodyState,
        (value) => value.marker === "two",
        "the second Revision",
      );
      const turns = received.filter((turn) => turn.text.includes("second pass"));
      assert.deepEqual(
        turns.map((turn) => turn.tools),
        [true, false],
        "a server without tool support gets one request without tools",
      );
      assert.equal(turns[1]!.images, 1, "only the screenshot, no references");
      assert.equal(state.background, "rgb(4, 5, 6)");
      assert.equal(state.leak, null, "the first script no longer runs");
    },
  );

  await step("restoring the first Revision brings it back", async () => {
    const style = await worker.evaluate(
      async (key) =>
        (await chrome.storage.local.get(key))[key] as { revisions: Array<{ id: string }> },
      `site:${origin}`,
    );
    assert.equal(style.revisions.length, 2);
    await send({ _tag: "RestoreRevision", tabId, origin, revisionId: style.revisions[0]!.id });
    await until(
      bodyState,
      (value) => value.marker === "one" && value.background === "rgb(1, 2, 3)",
      "the restored Revision",
    );
  });

  await step("turning the Site Style off removes it", async () => {
    await send({ _tag: "SetEnabled", tabId, origin, enabled: false });
    await until(
      bodyState,
      (value) => value.marker === null && value.background === "rgba(0, 0, 0, 0)",
      "the reloaded, unstyled page",
    );
    await send({ _tag: "SetEnabled", tabId, origin, enabled: true });
    await until(bodyState, (value) => value.marker === "one", "the Site Style to come back");
  });

  await step("the element picker reports the clicked element", async () => {
    await send({ _tag: "StartPicker", tabId });
    await site.bringToFront();
    const box = (await site.locator("button.buy").boundingBox())!;
    await site.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await site.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const picked = await until(
      () =>
        worker.evaluate(
          async (key) =>
            (await chrome.storage.session.get(key))[key] as
              | { selector: string; description: string }
              | undefined,
          `picked:${tabId}`,
        ),
      Boolean,
      "the picked element",
    );
    assert.equal(picked!.description, "button “Buy now”");
    assert.equal(await site.locator(picked!.selector).count(), 1, "the selector is unique");
  });

  await step("an imported Site Style becomes a new Revision", async () => {
    await send({
      _tag: "ImportSites",
      sites: [
        {
          origin,
          prompt: "imported",
          summary: "Imported.",
          css: "body { background: rgb(7, 8, 9) !important; }",
          script: "",
          model: "m",
        },
      ],
    });
    await site.reload();
    await until(
      bodyState,
      (value) => value.background === "rgb(7, 8, 9)" && value.marker === null,
      "the imported Revision",
    );
  });
} finally {
  await context.close();
  server.close();
  rmSync(extensionDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
console.log("All end-to-end checks passed.");
