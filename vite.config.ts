import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [
        react({}),
        tsconfigPaths(),
        viteStaticCopy({
            targets: [{ src: "node_modules/monaco-editor/min/vs/*", dest: "monaco" }],
        }),
    ],
    publicDir: "public",
    build: {
        target: "es6",
        sourcemap: true,
        rollupOptions: {
            input: {
                app: "public/index.html",
            },
        },
    },
});
