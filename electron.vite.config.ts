// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "electron-vite";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { viteStaticCopy } from "vite-plugin-static-copy";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

// from our electron build
const CHROME = "chrome140";
const NODE = "node22";

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
        },
        plugins: [tsconfigPaths()],
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
                        if (p.includes("node_modules/mermaid") || p.includes("node_modules/@mermaid"))
                            return "mermaid";
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
                ignored: ["dist/**", "**/*.go", "**/go.mod", "**/go.sum", "**/*.md", "**/*.json", "emain/**"],
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
            viteStaticCopy({
                targets: [{ src: "node_modules/monaco-editor/min/vs/*", dest: "monaco" }],
            }),
        ],
    },
});
