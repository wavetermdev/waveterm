import type { Meta, StoryObj } from "@storybook/react";
import DonutChart from "./donutchart";

const meta = {
    title: "Components/DonutChart",
    component: DonutChart,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The `DonutChart` component displays data in a donut-style chart with customizable colors, labels, and tooltip. Useful for visualizing proportions or percentages.",
            },
        },
    },
    argTypes: {
        data: {
            description:
                "The data for the chart, where each item includes `label`, `value`, and optional `displayvalue`.",
            control: { type: "object" },
        },
        config: {
            description: "config for the chart",
            control: { type: "object" },
        },
        innerLabel: {
            description: "The label displayed inside the donut chart (e.g., percentages).",
            control: { type: "text" },
        },
    },
    decorators: [
        (Story) => (
            <div
                style={{
                    width: "200px",
                    height: "200px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    border: "1px solid #ddd",
                }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof DonutChart>;

export default meta;
type Story = StoryObj<typeof DonutChart>;

export const Default: Story = {
    args: {
        config: {
            chrome: { label: "Chrome", color: "#8884d8" },
            safari: { label: "Safari", color: "#82ca9d" },
            firefox: { label: "Firefox", color: "#ffc658" },
            edge: { label: "Edge", color: "#ff8042" },
            other: { label: "Other", color: "#8dd1e1" },
        },
        data: [
            { label: "chrome", value: 275, fill: "#8884d8" }, // Purple
            { label: "safari", value: 200, fill: "#82ca9d" }, // Green
            { label: "firefox", value: 287, fill: "#ffc658" }, // Yellow
            { label: "edge", value: 173, fill: "#ff8042" }, // Orange
            { label: "other", value: 190, fill: "#8dd1e1" }, // Light Blue
        ],
        innerLabel: "50%",
        innerSubLabel: "50/100",
        dataKey: "value",
        nameKey: "label",
    },
};
