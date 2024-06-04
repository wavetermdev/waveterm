import type { StorybookConfig } from "@storybook/react-vite";

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
};
export default config;
