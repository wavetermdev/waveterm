// organize-imports-ignore
import type { Preview } from "@storybook/react";
import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import "../frontend/app/theme.scss";
import "../frontend/app/app.scss";
import "../frontend/app/reset.scss";
import "./global.css";
import { light, dark } from "./theme";
import { DocsContainer } from "@storybook/addon-docs";

import { addons } from "@storybook/preview-api";
import { DARK_MODE_EVENT_NAME } from "storybook-dark-mode";

const channel = addons.getChannel();

const preview: Preview = {
    parameters: {
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
        darkMode: {
            dark,
            light,
            stylePreview: true,
            classTarget: "html",
        },
        docs: {
            container: (props) => {
                const [isDark, setDark] = React.useState();

                React.useEffect(() => {
                    channel.on(DARK_MODE_EVENT_NAME, setDark);
                    return () => channel.removeListener(DARK_MODE_EVENT_NAME, setDark);
                }, [channel, setDark]);

                return (
                    <div>
                        <DocsContainer {...props} theme={isDark ? dark : light} />
                    </div>
                );
            },
        },
    },

    decorators: [
        (Story) => (
            <DndProvider backend={HTML5Backend}>
                <Story />
            </DndProvider>
        ),
    ],

    tags: ["autodocs"],
};

export default preview;
