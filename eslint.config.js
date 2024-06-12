// @ts-check

import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const baseConfig = tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier);

const customConfig = {
    ...baseConfig,
    overrides: [
        {
            files: ["emain/emain.ts", "vite.config.ts", "electron.vite.config.ts"],
            env: {
                node: true,
            },
        },
    ],
};

export default customConfig;
