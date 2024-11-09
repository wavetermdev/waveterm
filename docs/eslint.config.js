// @ts-check

import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import * as mdx from "eslint-plugin-mdx";
import tseslint from "typescript-eslint";

const baseConfig = tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    mdx.flat,
    mdx.flatCodeBlocks
);

const customConfig = {
    ...baseConfig,
    overrides: [
        {
            files: ["emain/emain.ts", "electron.vite.config.ts"],
            env: {
                node: true,
            },
        },
    ],
};

export default [customConfig, eslintConfigPrettier];
