import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, TooltipProps } from "recharts";
import { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

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

const CustomTooltip = ({ active, payload, label }: TooltipProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null;

    const data = payload[0].payload;

    return (
        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm shadow-lg">
            <div className="font-medium text-gray-900">{data.name}</div>
            <div className="text-gray-600">
                {data.displayValue} ({data.percentage}%)
            </div>
        </div>
    );
};

const DonutChart = ({
    data = [],
    valueKey = "value",
    displayValueKey = "displayvalue",
    labelKey = "label",
    colors = DEFAULT_COLORS,
    innerRadius = 60,
    outerRadius = 80,
    insideLabel = null,
    bottomLabel = null,
}) => {
    const validData: any[] = data.filter((item) => {
        const value = item[valueKey];
        return value != null && !Number.isNaN(value) && value > 0;
    });

    if (colors == null || colors.length === 0) {
        colors = DEFAULT_COLORS;
    }

    if (validData.length == 0) {
        colors = [NO_DATA_COLOR];
        validData.push({
            [valueKey]: 1,
            [displayValueKey]: "No data",
            [labelKey]: "No data",
        });
    }

    const total = validData.reduce((sum, item) => sum + item[valueKey], 0);
    const formattedData = validData.map((item) => ({
        value: item[valueKey],
        displayValue: item[displayValueKey] || String(item[valueKey]),
        name: item[labelKey],
        percentage: ((item[valueKey] / total) * 100).toFixed(1),
    }));

    const primaryItem = formattedData.reduce((max, item) => (item.value > max.value ? item : max), formattedData[0]);

    return (
        <div
            className="tw"
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                height: "100%",
            }}
        >
            <ResponsiveContainer>
                <PieChart>
                    <Tooltip content={<CustomTooltip />} cursor={false} />
                    <Pie
                        data={formattedData}
                        cx="50%"
                        cy="50%"
                        innerRadius={innerRadius}
                        outerRadius={outerRadius}
                        dataKey="value"
                        nameKey="name"
                        paddingAngle={0}
                    >
                        {formattedData.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={colors[index % colors.length]}
                                stroke="none"
                                className="transition-all duration-200 hover:opacity-80"
                            />
                        ))}
                    </Pie>
                    {insideLabel && (
                        <text
                            x="50%"
                            y="50%"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="text-lg font-medium fill-white"
                        >
                            {insideLabel.split("\n").map((line, index, lines) => (
                                <tspan
                                    key={index}
                                    x="50%" // Keep text horizontally centered
                                    dy={`${index === 0 ? -((lines.length - 1) / 2) * 1.4 : 1.4}em`} // Adjust spacing with 1.4em
                                >
                                    {line}
                                </tspan>
                            ))}
                        </text>
                    )}
                </PieChart>
            </ResponsiveContainer>
            {bottomLabel && <div className="mb-1 text-center text-sm font-medium text-white"> {bottomLabel}</div>}
        </div>
    );
};

export default DonutChart;
