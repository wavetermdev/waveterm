// organize-imports-ignore
import type { Preview } from "@storybook/react";
import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import "../frontend/app/theme.less";
import "../frontend/app/app.less";
import "../frontend/app/reset.less";
import "./global.css";

const preview: Preview = {
    parameters: {
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
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
