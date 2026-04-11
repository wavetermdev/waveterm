// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "electron-vite";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

const CHROME = "chrome140";
const NODE = "node22";

/**
 * Rewrites all ESM import forms from "electron" so that every access goes
 * through the CJS default export (module.exports) at runtime. This works
 * around Node.js v24's stricter CJS-to-ESM static analysis which cannot
 * detect lazy-getter exports (BaseWindow, BrowserWindow, etc.) from
 * Electron's CJS module.
 *
 * Three patterns are handled:
 *
 *   import * as electron from "electron"
 *     → import electron from "electron"
 *       (namespace → default; electron.X now hits module.exports.X directly)
 *
 *   import electron__default, { app, net as net$1 } from "electron"
 *     → import electron__default from "electron"
 *       const { app, net: net$1 } = electron__default
 *
 *   import { app, BaseWindow } from "electron"
 *     → import __electron__ from "electron"
 *       const { app, BaseWindow } = __electron__
 */
function electronEsmInteropPlugin() {
    const importAsToDestructure = (namedImports: string): string =>
        namedImports
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.replace(/^([\w$]+)\s+as\s+([\w$]+)$/, "$1: $2"))
            .join(", ");

    return {
        name: "electron-esm-interop",
        renderChunk(code: string) {
            let result = code;
            let transformed = false;

            result = result.replace(
                /import\s+([\w$]+)\s*,\s*\{([^}]+)\}\s*from\s*["']electron["']\s*;?/g,
                (_match: string, defaultName: string, named: string) => {
                    transformed = true;
                    return `import ${defaultName} from "electron";\nconst { ${importAsToDestructure(named)} } = ${defaultName};`;
                }
            );

            result = result.replace(
                /import\s*\{([^}]+)\}\s*from\s*["']electron["']\s*;?/g,
                (_match: string, named: string) => {
                    transformed = true;
                    return `import __electron__ from "electron";\nconst { ${importAsToDestructure(named)} } = __electron__;`;
                }
            );

            result = result.replace(
                /import\s*\*\s*as\s+([\w$]+)\s+from\s*["']electron["']\s*;?/g,
                (_match: string, nsName: string) => {
                    transformed = true;
                    return `import ${nsName} from "electron";`;
                }
            );

            return transformed ? { code: result, map: null } : null;
        },
    };
}

// for debugging
// target is like -- path.resolve(__dirname, "frontend/app/workspace/workspace-layout-model.ts");
function whoImportsTarget(target: string) {
    return {
        name: "who-imports-target",
        buildEnd() {
            // Build reverse graph: child -> [importers...]
            const parents = new Map<string, string[]>();
            for (const id of (this as any).getModuleIds()) {
                const info = (this as any).getModuleInfo(id);
                if (!info) continue;
                for (const child of [...info.importedIds, ...info.dynamicallyImportedIds]) {
                    const arr = parents.get(child) ?? [];
                    arr.push(id);
                    parents.set(child, arr);
                }
            }

            // Walk upward from TARGET and print paths to entries
            const entries = [...parents.keys()].filter((id) => {
                const m = (this as any).getModuleInfo(id);
                return m?.isEntry;
            });

            const seen = new Set<string>();
            const stack: string[] = [];
            const dfs = (node: string) => {
                if (seen.has(node)) return;
                seen.add(node);
                stack.push(node);
                const ps = parents.get(node) || [];
                if (ps.length === 0) {
                    // hit a root (likely main entry or plugin virtual)
                    console.log("\nImporter chain:");
                    stack
                        .slice()
                        .reverse()
                        .forEach((s) => console.log("  ↳", s));
                } else {
                    for (const p of ps) dfs(p);
                }
                stack.pop();
            };

            if (!parents.has(target)) {
                console.log(`[who-imports] TARGET not in MAIN graph: ${target}`);
            } else {
                dfs(target);
            }
        },
        async resolveId(id: any, importer: any) {
            const r = await (this as any).resolve(id, importer, { skipSelf: true });
            if (r?.id === target) {
                console.log(`[resolve] ${importer} -> ${id} -> ${r.id}`);
            }
            return null;
        },
    };
}

export default defineConfig({
    main: {
        root: ".",
        build: {
            target: NODE,
            rollupOptions: {
                input: {
                    index: "emain/emain.ts",
                },
            },
            outDir: "dist/main",
            externalizeDeps: false,
        },
        plugins: [tsconfigPaths(), electronEsmInteropPlugin()],
        resolve: {
            alias: {
                "@": "frontend",
            },
        },
        server: {
            open: false,
        },
        define: {
            "process.env.WS_NO_BUFFER_UTIL": "true",
            "process.env.WS_NO_UTF_8_VALIDATE": "true",
        },
    },
    preload: {
        root: ".",
        build: {
            target: NODE,
            sourcemap: true,
            rollupOptions: {
                input: {
                    index: "emain/preload.ts",
                    "preload-webview": "emain/preload-webview.ts",
                },
                output: {
                    format: "cjs",
                },
            },
            outDir: "dist/preload",
            externalizeDeps: false,
        },
        server: {
            open: false,
        },
        plugins: [tsconfigPaths()],
    },
    renderer: {
        root: ".",
        build: {
            target: CHROME,
            sourcemap: true,
            outDir: "dist/frontend",
            rollupOptions: {
                input: {
                    index: "index.html",
                },
                output: {
                    manualChunks(id) {
                        const p = id.replace(/\\/g, "/");
                        if (p.includes("node_modules/monaco") || p.includes("node_modules/@monaco")) return "monaco";
                        if (p.includes("node_modules/mermaid") || p.includes("node_modules/@mermaid")) return "mermaid";
                        if (p.includes("node_modules/katex") || p.includes("node_modules/@katex")) return "katex";
                        if (p.includes("node_modules/shiki") || p.includes("node_modules/@shiki")) {
                            return "shiki";
                        }
                        if (p.includes("node_modules/cytoscape") || p.includes("node_modules/@cytoscape"))
                            return "cytoscape";
                        return undefined;
                    },
                },
            },
        },
        optimizeDeps: {
            include: ["monaco-yaml/yaml.worker.js"],
        },
        server: {
            open: false,
            watch: {
                ignored: [
                    "dist/**",
                    "**/*.go",
                    "**/go.mod",
                    "**/go.sum",
                    "**/*.md",
                    "**/*.mdx",
                    "**/*.json",
                    "**/emain/**",
                    "**/*.txt",
                    "**/*.log",
                ],
            },
        },
        css: {
            preprocessorOptions: {
                scss: {
                    silenceDeprecations: ["mixed-decls"],
                },
            },
        },
        plugins: [
            tsconfigPaths(),
            { ...ViteImageOptimizer(), apply: "build" },
            svgr({
                svgrOptions: { exportType: "default", ref: true, svgo: false, titleProp: true },
                include: "**/*.svg",
            }),
            react({}),
            tailwindcss(),
        ],
    },
});
