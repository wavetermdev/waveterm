import type { StorybookConfig } from "@storybook/react-vite";
import { UserConfig, mergeConfig } from "vite";
import electronViteConfig from "../electron.vite.config";

const config: StorybookConfig = {
    stories: ["../frontend/**/*.mdx", "../frontend/**/*.stories.@(js|jsx|mjs|ts|tsx)"],

    addons: [
        "@storybook/addon-links",
        "@storybook/addon-essentials",
        "@chromatic-com/storybook",
        "@storybook/addon-interactions",
    ],

    core: {
        builder: "@storybook/builder-vite",
    },

    framework: {
        name: "@storybook/react-vite",
        options: {},
    },

    docs: {},

    managerHead: (head) => `
        ${head}
        <meta name="robots" content="noindex" />
        `,

    typescript: {
        reactDocgen: "react-docgen-typescript",
    },

    viteFinal(config) {
        return mergeConfig(config, electronViteConfig.renderer as UserConfig);
    },
};
export default config;
