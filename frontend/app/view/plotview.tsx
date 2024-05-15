import * as React from "react";
import * as Plot from "@observablehq/plot";
import * as d3 from "d3";

function PlotWindow() {
    return <div className="plot-window"></div>;
}

function PlotConfig() {
    return <input type="text" className="plot-config" />;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function evalAsync(Plot: any, d3: any, funcText: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        new AsyncFunction(
            "resolve",
            "reject",
            "Plot",
            "d3",
            `try { await ${funcText}; resolve(); } catch(e) { reject(e); } }`
        )(resolve, reject, Plot, d3);
    });
}

function PlotView() {
    const containerRef = React.useRef<HTMLInputElement>();
    const [plotDef, setPlotDef] = React.useState<string>();
    /*
    const [data, setData] = React.useState();

    React.useEffect(() => {
        d3.csv("/plotdata/congress.csv", d3.autoType).then(setData);
    }, []);
    */

    React.useEffect(() => {
        // replace start
        /*
        d3.csv("/plotdata/congress.csv", d3.autoType).then((out) => data = out);
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
            plot = new Function("Plot", "d3", plotDef)(Plot, d3);
            //plot = new Function("Plot", "data", "d3", plotDef)(Plot, data, d3);
            //evalAsync(Plot, d3, plotDef).then((out) => (plot = out));
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
    }, [plotDef]);

    return (
        <div className="plot-block">
            ß
            <div className="plot-window" ref={containerRef} />
            <textarea className="plot-config" onChange={(e) => setPlotDef(e.target.value)} />
        </div>
    );
}

export { PlotView };
