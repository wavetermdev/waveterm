# Monaco 0.52 → 0.53 ESM Migration Plan (Vite/Electron)

**Status:** Deferred to next release.
**Current:** Pinned to `monaco-editor@0.52.x` (works with `@monaco-editor/loader`).
**Target:** Switch to `monaco-editor@≥0.53` ESM build and drop `@monaco-editor/loader` + AMD path copy.

---

## Why this change

- Monaco 0.53 deprecates the AMD build. The loader/AMD path mapping (`paths: { vs: "monaco" }`) becomes brittle.
- ESM build uses **module workers**, which require explicit worker wiring.
- Benefits: cleaner bundling with Vite, fewer legacy shims, better CSP/Electron compatibility.

---

## High‑level plan

1. **Remove AMD/loader**: uninstall `@monaco-editor/loader`; remove `viteStaticCopy` of `min/vs/*`; delete `loader.config/init` calls.
2. **Install Monaco ≥0.53** and **wire ESM workers** via `MonacoEnvironment.getWorker`.
3. **Keep main bundle slim**: lazy‑load the Monaco setup; optionally force a separate `monaco` chunk.
4. **Electron / build**: ensure `base: './'` in Vite for packaged apps.

---

## Step‑by‑step

### 1) Dependencies

```bash
# next cycle:
npm rm @monaco-editor/loader
npm i monaco-editor@^0.53
```

### 2) Remove AMD-era build config

- Delete `viteStaticCopy({ targets: [{ src: "node_modules/monaco-editor/min/vs/*", dest: "monaco" }] })`.
- Delete:

  ```ts
  loader.config({ paths: { vs: "monaco" } });
  await loader.init();
  ```

### 3) Add ESM setup module

Create `monaco-setup.ts`:

```ts
// monaco-setup.ts
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all.css";

(self as any).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case "json":
        return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), {
          type: "module",
        });
      case "css":
        return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), {
          type: "module",
        });
      case "html":
        return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), {
          type: "module",
        });
      case "typescript":
      case "javascript":
        return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), {
          type: "module",
        });
      default:
        return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" });
    }
  },
};

export { monaco };
```

### 4) Import lazily where used

```ts
// where the editor UI mounts
const { monaco } = await import("./monaco-setup");
const editor = monaco.editor.create(container, { language: "javascript", value: "" });
```

### 5) Optional: isolate Monaco into its own chunk

`vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // important for Electron packaged apps
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/monaco-editor")) return "monaco";
        },
      },
    },
  },
});
```

> Note: Workers created via `new URL(..., import.meta.url)` are emitted as **separate chunks** automatically.

---

## Bundle size controls (pick what you need)

- Import `editor.api` instead of full `editor` (already done above).
- Only include workers you use (drop `json/css/html` blocks if not needed).
- Lazy‑load Monaco with `import()` behind the UI that needs it.
- Optionally dynamic‑import language contributions on demand:

  ```ts
  if (lang === "json") {
    await import("monaco-editor/esm/vs/language/json/monaco.contribution");
  }
  ```

---

## Electron specifics

- `base: './'` in `vite.config.ts` so worker URLs resolve under `file://` in packaged apps.
- `{ type: 'module' }` is required for Monaco’s ESM workers.
- This approach avoids blob URLs and works with stricter CSPs.

---

## Test checklist

- Dev: editor renders; no 404s for worker scripts; language services active (TS hover/diagnostics, JSON schema).
- Prod build: verify worker files emitted; open packaged Electron app and ensure workers load (no "Cannot use import statement outside a module").
- Hot paths: open/close editor repeatedly; memory doesn’t grow unbounded.

---

## Rollback plan

If anything blocks the release, revert to:

```bash
npm i monaco-editor@0.52.x
npm i -D @monaco-editor/loader
```

Restore the `viteStaticCopy` block and `loader.config/init` calls.

---

## Open questions (optional)

- Do we need JSON/CSS/HTML workers in the default bundle? (Decide before wiring.)
- Any extra CSP limitations for production? (If so, confirm worker script allowances.)

---

## Snippet index (for quick copy)

- `monaco-setup.ts` (ESM + workers): see above.
- `vite.config.ts` (`base: './'` + `manualChunks`): see above.
- Lazy import site: `const { monaco } = await import('./monaco-setup');`
