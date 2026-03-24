// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import {
    LineChart,
    AreaChart,
    BarChart,
    PieChart,
    ScatterChart,
    RadarChart,
    ComposedChart,
    CartesianGrid,
    XAxis,
    YAxis,
    ZAxis,
    Tooltip,
    Legend,
    Line,
    Area,
    Bar,
    Pie,
    Cell,
    Scatter,
    Radar,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    ReferenceLine,
    ReferenceArea,
    ReferenceDot,
    Brush,
    ErrorBar,
    LabelList,
    FunnelChart,
    Funnel,
    Treemap,
} from "recharts";

import type { TsunamiModel } from "@/model/tsunami-model";
import { convertElemToTag } from "@/vdom";

type VDomRechartsTagType = (props: { elem: VDomElem; model: TsunamiModel }) => React.ReactElement;

// Map recharts component names to their actual components
const RechartsComponentMap: Record<string, React.ComponentType<any>> = {
    LineChart,
    AreaChart,
    BarChart,
    PieChart,
    ScatterChart,
    RadarChart,
    ComposedChart,
    CartesianGrid,
    XAxis,
    YAxis,
    ZAxis,
    Tooltip,
    Legend,
    Line,
    Area,
    Bar,
    Pie,
    Cell,
    Scatter,
    Radar,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    ReferenceLine,
    ReferenceArea,
    ReferenceDot,
    Brush,
    ErrorBar,
    LabelList,
    FunnelChart,
    Funnel,
    Treemap,
};

// Handler for recharts components - uses the same pattern as VDomTag from vdom.tsx
function RechartsTag({ elem, model }: { elem: VDomElem; model: TsunamiModel }) {
    // Convert props
    const props = convertRechartsProps(model, elem);
    
    // Extract the component name from the tag (remove "recharts:" prefix)
    const componentName = elem.tag.replace("recharts:", "");
    
    // Get the React component from the map
    const RechartsComponent = RechartsComponentMap[componentName];
    
    if (!RechartsComponent) {
        return <div>{"Invalid Recharts Component <" + elem.tag + ">"}</div>;
    }
    
    const children = convertRechartsChildren(elem, model);
    
    // Add the waveid as key
    props.key = "recharts-" + elem.waveid;
    
    return React.createElement(RechartsComponent, props, children);
}

// Simplified version of useVDom for recharts - handles basic prop conversion
function convertRechartsProps(model: TsunamiModel, elem: VDomElem): any {
    // For now, do a basic prop conversion without full binding support
    // This can be enhanced later to use the full useVDom functionality
    if (!elem.props) {
        return {};
    }
    
    const props: any = {};
    for (const [key, value] of Object.entries(elem.props)) {
        if (value != null) {
            props[key] = value;
        }
    }
    
    return props;
}

// Convert children for recharts components - return literal Recharts components
function convertRechartsChildren(elem: VDomElem, model: TsunamiModel): React.ReactNode[] | null {
    if (!elem.children || elem.children.length === 0) {
        return null;
    }
    
    const children: React.ReactNode[] = [];
    
    for (const child of elem.children) {
        if (!child) continue;
        
        if (child.tag === "#text") {
            // Allow text nodes (rare but valid)
            children.push(child.text ?? "");
            continue;
        }
        
        if (child.tag?.startsWith("recharts:")) {
            // Extract component name and get the actual Recharts component
            const componentName = child.tag.replace("recharts:", "");
            const RechartsComponent = RechartsComponentMap[componentName];
            
            if (RechartsComponent) {
                // Convert props using the same logic as convertRechartsProps
                const childProps = convertRechartsProps(model, child);
                childProps.key = "recharts-" + child.waveid;
                
                // Recursively convert children
                const grandChildren = convertRechartsChildren(child, model);
                
                // Create the raw Recharts component directly
                children.push(React.createElement(RechartsComponent, childProps, grandChildren));
            }
            continue;
        }
        
        // Non-Recharts nodes under charts aren't supported; drop silently
        // Could add warning: console.warn("Unsupported child type in Recharts:", child.tag);
    }
    
    return children.length > 0 ? children : null;
}


export { RechartsTag };