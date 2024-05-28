import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [react({}), tsconfigPaths()],
    publicDir: "public",
    build: {
        target: "es6",
        rollupOptions: {
            input: {
                app: "public/index.html",
            },
        },
    },
});
