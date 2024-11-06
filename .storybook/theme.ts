import { create } from "@storybook/theming";

export const light = create({
    base: "light",
    brandTitle: "Wave Terminal Storybook",
    brandUrl: "https://docs.waveterm.dev/storybook/",
    brandImage: "./assets/wave-light.png",
    brandTarget: "_self",
});

export const dark = create({
    base: "dark",
    brandTitle: "Wave Terminal Storybook",
    brandUrl: "https://docs.waveterm.dev/storybook/",
    brandImage: "./assets/wave-dark.png",
    brandTarget: "_self",
});
