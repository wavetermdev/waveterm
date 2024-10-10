import { FORCE_RE_RENDER } from "@storybook/core-events";
import { addons } from "@storybook/manager-api";
import { UPDATE_DARK_MODE_EVENT_NAME } from "storybook-dark-mode";
import { dark, light } from "../../theme";

addons.register("theme-switcher", (api) => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const channel = addons.getChannel();
    const update = () => {
        const theme = query.matches ? dark : light;
        api.setOptions({ theme });
        channel.emit(FORCE_RE_RENDER);
        channel.emit(UPDATE_DARK_MODE_EVENT_NAME);
    };

    channel.on("storiesConfigured", update);
    query.addEventListener("change", update);
});
