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
        colors: {
            description: "An array of colors for chart segments.",
            control: { type: "object" },
        },
        innerRadius: {
            description: "Inner radius of the donut chart.",
            control: { type: "number" },
        },
        outerRadius: {
            description: "Outer radius of the donut chart.",
            control: { type: "number" },
        },
        insideLabel: {
            description: "The label displayed inside the donut chart (e.g., percentages).",
            control: { type: "text" },
        },
        bottomLabel: {
            description: "The label displayed below the donut chart.",
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
        data: [
            { label: "Chrome", value: 275 },
            { label: "Safari", value: 200 },
            { label: "Firefox", value: 187 },
        ],
        insideLabel: "50%",
        bottomLabel: "Browser Usage",
    },
};

export const WithDisplayValues: Story = {
    args: {
        data: [
            { label: "Chrome", value: 275, displayvalue: "275 users" },
            { label: "Safari", value: 200, displayvalue: "200 users" },
            { label: "Firefox", value: 187, displayvalue: "187 users" },
        ],
        insideLabel: "75%",
        bottomLabel: "Total Users",
    },
};

export const CustomColors: Story = {
    args: {
        ...Default.args,
        colors: ["#FF6B6B", "#4ECDC4", "#45B7D1"],
        insideLabel: "44%\n44/100",
        bottomLabel: "Memory",
    },
};

export const EmptyData: Story = {
    args: {
        data: [],
        insideLabel: "No Data",
        bottomLabel: "Empty Chart",
    },
};

export const SingleValue: Story = {
    args: {
        data: [{ label: "Chrome", value: 275, displayvalue: "275 users" }],
        insideLabel: "100%",
        bottomLabel: "Single Value",
    },
};

export const CustomRadii: Story = {
    args: {
        ...Default.args,
        innerRadius: 50,
        outerRadius: 100,
        insideLabel: "Custom",
        bottomLabel: "Radius",
    },
};
