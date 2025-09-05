// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": "/src",
        },
    },
    server: {
        port: 12025,
        open: true,
        proxy: {
            "/api": {
                target: "http://localhost:12026",
                changeOrigin: true,
            },
            "/assets": {
                target: "http://localhost:12026",
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: "dist",
        minify: process.env.NODE_ENV === "development" ? false : "esbuild",
        sourcemap: process.env.NODE_ENV === "development" ? true : false,
    },
});
