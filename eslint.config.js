// @ts-check

import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    {
        files: ["emain/emain.ts", "electron.vite.config.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    eslintConfigPrettier,
];
