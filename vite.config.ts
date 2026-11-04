import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));
const outDir = fileURLToPath(new URL("./dist", import.meta.url));

export default defineConfig({
  root: src(""),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react(), tailwindcss()],
  // Extension pages and the service worker share ES module chunks, but a
  // content script must be one classic script, so it gets its own environment.
  builder: {},
  environments: {
    client: {
      build: {
        outDir,
        // Both environments write to dist/, and a watch rebuild of one must not
        // delete the other's output; the justfile cleans dist/ before building.
        emptyOutDir: false,
        rolldownOptions: {
          input: {
            popup: src("popup/index.html"),
            options: src("options/index.html"),
            background: src("background/+background.ts"),
          },
          output: {
            entryFileNames: (chunk) =>
              chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
          },
        },
      },
    },
    content: {
      consumer: "client",
      build: {
        outDir,
        emptyOutDir: false,
        copyPublicDir: false,
        rolldownOptions: {
          input: { content: src("content/+content.ts") },
          output: { format: "iife", entryFileNames: "content.js" },
        },
      },
    },
  },
  test: {
    include: ["**/*.test.ts"],
  },
  fmt: {
    ignorePatterns: ["dist/**"],
    sortPackageJson: true,
    sortTailwindcss: {
      stylesheet: "./src/ui/styles.css",
      functions: ["cn"],
    },
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: ["eslint-plugin-better-tailwindcss"],
    settings: {
      "better-tailwindcss": {
        entryPoint: "src/ui/styles.css",
        callees: ["cn"],
      },
    },
    rules: {
      "better-tailwindcss/no-duplicate-classes": "error",
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-unknown-classes": "error",
    },
  },
});
