// @ts-check

import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const tsconfigRootDir = path.dirname(fileURLToPath(new URL(import.meta.url)));

export default [
    {
        languageOptions: {
            parserOptions: {
                tsconfigRootDir,
            },
        },
    },

    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/make/**",
            "tsunami/frontend/scaffold/**",
            "docs/.docusaurus/**",
        ],
    },

    {
        files: ["frontend/**/*.{ts,tsx}", "emain/**/*.{ts,tsx}"],
        languageOptions: {
            parserOptions: {
                tsconfigRootDir,
                project: "./tsconfig.json",
            },
        },
    },

    {
        files: ["docs/**/*.{ts,tsx}"],
        languageOptions: {
            parserOptions: { tsconfigRootDir, project: "./docs/tsconfig.json" },
        },
    },

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    {
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    {
        files: ["emain/**/*.ts", "electron.vite.config.ts", "**/*.cjs", "eslint.config.js", "docs/babel.config.js"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    {
        files: ["**/*.js", "**/*.cjs"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },

    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_$",
                    varsIgnorePattern: "^_$",
                },
            ],
            "prefer-const": "warn",
            "no-empty": "warn",
        },
    },

    {
        files: ["frontend/app/store/services.ts"],
        rules: {
            "prefer-rest-params": "off",
        },
    },

    eslintConfigPrettier,
];
