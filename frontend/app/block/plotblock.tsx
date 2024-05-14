import * as React from "react";
import * as Plot from "@observablehq/plot";
import * as d3 from "d3";

function PlotWindow() {
    return <div className="plot-window"></div>;
}

function PlotConfig() {
    return <input type="text" className="plot-config" />;
}

function PlotBlock() {
    const containerRef = React.useRef<HTMLInputElement>();
    const [data, setData] = React.useState();

    React.useEffect(() => {
        d3.csv("/plotdata/congress.csv", d3.autoType).then(setData);
    }, []);

    React.useEffect(() => {
        if (data === undefined) {
            return;
        }
        // replace start
        const plot = Plot.plot({
            aspectRatio: 1,
            x: { label: "Age (years)" },
            y: {
                grid: true,
                label: "← Women · Men →",
                labelAnchor: "center",
                tickFormat: Math.abs,
            },
            marks: [
                Plot.dot(
                    data,
                    Plot.stackY2({
                        x: (d) => 2023 - d.birthday.getUTCFullYear(),
                        y: (d) => (d.gender === "M" ? 1 : -1),
                        fill: "gender",
                        title: "full_name",
                    })
                ),
                Plot.ruleY([0]),
            ],
        });
        // replace end
        containerRef.current.append(plot);

        return () => {
            plot.remove();
        };
    }, [data]);

    return (
        <div className="plot-block">
            <div className="plot-window" ref={containerRef} />
            <PlotConfig />
        </div>
    );
}

export { PlotBlock };
