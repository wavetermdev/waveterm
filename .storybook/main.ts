import type { StorybookConfig } from "@storybook/react-vite";
import type { ElectronViteConfig } from "electron-vite";
import type { UserConfig } from "vite";

const config: StorybookConfig = {
    stories: ["../frontend/**/*.mdx", "../frontend/**/*.stories.@(js|jsx|mjs|ts|tsx)"],

    addons: [
        "@storybook/addon-links",
        "@storybook/addon-essentials",
        "@chromatic-com/storybook",
        "@storybook/addon-interactions",
        "storybook-dark-mode",
        "./custom-addons/theme/register",
    ],

    core: { builder: "@storybook/builder-vite" },

    framework: {
        name: "@storybook/react-vite",
        options: {},
    },

    docs: {},

    typescript: {
        reactDocgen: "react-docgen-typescript",
    },

    async viteFinal(config) {
        const { mergeConfig } = await import("vite");
        const { tsImport } = await import("tsx/esm/api");
        const electronViteConfig = (await tsImport("../electron.vite.config.ts", import.meta.url))
            .default as ElectronViteConfig;
        const mergedConfig = mergeConfig(config, electronViteConfig.renderer as UserConfig);
        mergedConfig.build.outDir = "storybook-static";
        return mergedConfig;
    },

    staticDirs: [
        { from: "../assets", to: "/assets" },
        { from: "../public/fontawesome", to: "/fontawesome" },
    ],
    managerHead: (head) => `
        ${head}
        <link rel="shortcut icon" href="./assets/waveterm-logo-with-bg.ico" />
        <link rel="icon" type="image/png" href="./assets/waveterm-logo-with-bg.png" sizes="250x250" />
        <style>
        .sidebar-header img {
            max-width: 150px !important;
            max-height: 100px !important;
        }
        </style>`,
    previewHead: (head) => `
        ${head}
        <link rel="stylesheet" href="./fontawesome/css/fontawesome.min.css" />
        <link rel="stylesheet" href="./fontawesome/css/brands.min.css" />
        <link rel="stylesheet" href="./fontawesome/css/solid.min.css" />
        <link rel="stylesheet" href="./fontawesome/css/sharp-solid.min.css" />
        <link rel="stylesheet" href="./fontawesome/css/sharp-regular.min.css" />
        <style>
        #storybook-docs {
            [id^="anchor--"],
            #stories {
            a {
                margin-left: -24px !important;
            }
            }
        }

        body {
            background-color: #ffffff !important;
        }

        html.dark {
            body {
            background-color: #222222 !important;
            }
        }
        </style>`,
};
export default config;
