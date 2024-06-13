// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    main: {
        root: ".",
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "emain/emain.ts"),
                },
            },
            outDir: "dist/main",
        },
        plugins: [tsconfigPaths()],
    },
    preload: {
        root: ".",
        build: {
            sourcemap: true,
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "emain/preload.ts"),
                },
                output: {
                    format: "cjs",
                },
            },
            outDir: "dist/preload",
        },
        plugins: [tsconfigPaths()],
    },
    renderer: {
        root: ".",
        build: {
            target: "es6",
            sourcemap: true,
            outDir: "dist/frontend",
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "index.html"),
                },
            },
        },
        plugins: [
            react({}),
            tsconfigPaths(),
            viteStaticCopy({
                targets: [{ src: "node_modules/monaco-editor/min/vs/*", dest: "monaco" }],
            }),
        ],
    },
});
