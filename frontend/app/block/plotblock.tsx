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
    const [plotDef, setPlotDef] = React.useState<string>();
    const [data, setData] = React.useState();

    React.useEffect(() => {
        d3.csv("/plotdata/congress.csv", d3.autoType).then(setData);
    }, []);

    React.useEffect(() => {
        // replace start
        /*
        return Plot.plot({
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
        */
        // replace end
        let plot;
        let plotErr;
        try {
            console.log(plotDef);
            plot = new Function("Plot", "data", plotDef)(Plot, data);
        } catch (e) {
            plotErr = e;
            console.log("error: ", e);
            return;
        }
        console.log(plot);

        if (plot !== undefined) {
            containerRef.current.append(plot);
        } else {
            // todo
        }

        return () => {
            if (plot !== undefined) {
                plot.remove();
            }
        };
    }, [data, plotDef]);

    return (
        <div className="plot-block">
            <div className="plot-window" ref={containerRef} />
            <input type="text" className="plot-config" onChange={(e) => setPlotDef(e.target.value)} />
        </div>
    );
}

export { PlotBlock };
