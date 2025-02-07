import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/app/shadcn/chart";
import { isBlank } from "@/util/util";
import { Label, Pie, PieChart } from "recharts";
import { ViewBox } from "recharts/types/util/types";

const DEFAULT_COLORS = [
    "#3498db", // blue
    "#2ecc71", // green
    "#e74c3c", // red
    "#f1c40f", // yellow
    "#9b59b6", // purple
    "#1abc9c", // turquoise
    "#e67e22", // orange
    "#34495e", // dark blue
];

const NO_DATA_COLOR = "#E0E0E0";

const PieInnerLabel = ({
    innerLabel,
    innerSubLabel,
    viewBox,
}: {
    innerLabel: string;
    innerSubLabel: string;
    viewBox: ViewBox;
}) => {
    if (isBlank(innerLabel)) {
        return null;
    }
    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
        return null;
    }
    return (
        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
            <tspan x={viewBox.cx} y={viewBox.cy} fill="white" className="fill-foreground text-2xl font-bold">
                {innerLabel}
            </tspan>
            {innerSubLabel && (
                <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground">
                    {innerSubLabel}
                </tspan>
            )}
        </text>
    );
};

const DonutChart = ({
    data,
    config,
    innerLabel,
    innerSubLabel,
    dataKey,
    nameKey,
}: {
    data: any[];
    config: ChartConfig;
    innerLabel?: string;
    innerSubLabel?: string;
    dataKey: string;
    nameKey: string;
}) => {
    return (
        <div className="flex flex-col items-center w-full h-full">
            <ChartContainer config={config} className="mx-auto w-full h-full aspect-square max-h-[250px]">
                <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie
                        data={data}
                        dataKey={dataKey}
                        nameKey={nameKey}
                        innerRadius={60}
                        strokeWidth={5}
                        isAnimationActive={false}
                    >
                        <Label
                            content={({ viewBox }) => (
                                <PieInnerLabel
                                    innerLabel={innerLabel}
                                    innerSubLabel={innerSubLabel}
                                    viewBox={viewBox}
                                />
                            )}
                        />
                    </Pie>
                </PieChart>
            </ChartContainer>
        </div>
    );
};

export default DonutChart;
