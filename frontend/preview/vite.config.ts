// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    root: __dirname,
    base: "./",
    // Serve the workspace-root public/ directory so Font Awesome and other
    // static assets (served by Electron in the real app) are available here too.
    publicDir: path.resolve(__dirname, "../../public"),
    plugins: [
        tsconfigPaths(),
        svgr({
            svgrOptions: { exportType: "default", ref: true, svgo: false, titleProp: true },
            include: "**/*.svg",
        }),
        react(),
        tailwindcss(),
    ],
    server: {
        port: 7007,
    },
});
