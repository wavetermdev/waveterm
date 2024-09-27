import { FORCE_RE_RENDER } from "@storybook/core-events";
import { addons } from "@storybook/manager-api";
import { dark, light } from "../../theme";

addons.register("theme-switcher", (api) => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
        const theme = query.matches ? dark : light;
        api.setOptions({ theme });
        addons.getChannel().emit(FORCE_RE_RENDER);
    };

    addons.getChannel().on("storiesConfigured", update);
    query.addEventListener("change", update);
});
