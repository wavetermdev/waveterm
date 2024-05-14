import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [react({}), tsconfigPaths()],
    publicDir: "public",
    build: {
        rollupOptions: {
            input: {
                app: "public/index.html",
            },
        },
    },
});
