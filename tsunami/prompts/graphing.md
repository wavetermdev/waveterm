# Graphing with Recharts in Tsunami

The Tsunami framework provides seamless integration with the Recharts library (v3), allowing you to create rich, interactive charts and graphs using familiar React patterns but with Go's type safety and performance.

## How Recharts Works in Tsunami

Recharts components are accessed through the `recharts:` namespace in your VDOM elements. This tells Tsunami's renderer to dispatch these elements to the specialized recharts handler instead of creating regular HTML elements.

```go
// Basic chart structure
vdom.H("recharts:ResponsiveContainer", map[string]any{
    "width":  "100%",
    "height": 300,
},
    vdom.H("recharts:LineChart", map[string]any{
        "data": chartData,
    },
        vdom.H("recharts:Line", map[string]any{
            "dataKey": "value",
            "stroke":  "#8884d8",
        }),
    ),
)
```

## Key Concepts

### Namespace Usage

All recharts components use the `recharts:` prefix and have the same names as their React counterparts:

- `recharts:ResponsiveContainer` - Container that responds to parent size changes
- `recharts:LineChart`, `recharts:AreaChart`, `recharts:BarChart` - Chart types
- `recharts:XAxis`, `recharts:YAxis` - Axis components
- `recharts:CartesianGrid`, `recharts:Tooltip`, `recharts:Legend` - Supporting components
- `recharts:Line`, `recharts:Area`, `recharts:Bar` - Data series components

Every Recharts component from the React library is available with the `recharts:` prefix.

### Data Structure

Charts expect Go structs or slices that can be serialized to JSON. Use json tags to control field names:

```go
type DataPoint struct {
    Time  int     `json:"time"`
    Value float64 `json:"value"`
    Label string  `json:"label"`
}

data := []DataPoint{
    {Time: 1, Value: 100, Label: "Jan"},
    {Time: 2, Value: 150, Label: "Feb"},
    {Time: 3, Value: 120, Label: "Mar"},
}
```

### Props and Configuration

Recharts components accept the same props as the React version, passed as Go map[string]any:

```go
vdom.H("recharts:Line", map[string]any{
    "type":        "monotone",    // Line interpolation
    "dataKey":     "value",       // Field name from data struct
    "stroke":      "#8884d8",     // Line color
    "strokeWidth": 2,             // Line thickness
    "dot":         false,         // Hide data points
})
```

## Chart Examples

### Simple Line Chart

```go
type MetricsData struct {
    Time int     `json:"time"`
    CPU  float64 `json:"cpu"`
    Mem  float64 `json:"mem"`
}

func renderLineChart(data []MetricsData) any {
    return vdom.H("recharts:ResponsiveContainer", map[string]any{
        "width":  "100%",
        "height": 400,
    },
        vdom.H("recharts:LineChart", map[string]any{
            "data": data,
        },
            vdom.H("recharts:CartesianGrid", map[string]any{
                "strokeDasharray": "3 3",
            }),
            vdom.H("recharts:XAxis", map[string]any{
                "dataKey": "time",
            }),
            vdom.H("recharts:YAxis", nil),
            vdom.H("recharts:Tooltip", nil),
            vdom.H("recharts:Legend", nil),
            vdom.H("recharts:Line", map[string]any{
                "type":    "monotone",
                "dataKey": "cpu",
                "stroke":  "#8884d8",
                "name":    "CPU %",
            }),
            vdom.H("recharts:Line", map[string]any{
                "type":    "monotone",
                "dataKey": "mem",
                "stroke":  "#82ca9d",
                "name":    "Memory %",
            }),
        ),
    )
}
```

### Area Chart with Stacking

```go
func renderAreaChart(data []MetricsData) any {
    return vdom.H("recharts:ResponsiveContainer", map[string]any{
        "width":  "100%",
        "height": 300,
    },
        vdom.H("recharts:AreaChart", map[string]any{
            "data": data,
        },
            vdom.H("recharts:XAxis", map[string]any{
                "dataKey": "time",
            }),
            vdom.H("recharts:YAxis", nil),
            vdom.H("recharts:Tooltip", nil),
            vdom.H("recharts:Area", map[string]any{
                "type":    "monotone",
                "dataKey": "cpu",
                "stackId": "1",
                "stroke":  "#8884d8",
                "fill":    "#8884d8",
            }),
            vdom.H("recharts:Area", map[string]any{
                "type":    "monotone",
                "dataKey": "mem",
                "stackId": "1",
                "stroke":  "#82ca9d",
                "fill":    "#82ca9d",
            }),
        ),
    )
}
```

### Bar Chart

```go
func renderBarChart(data []MetricsData) any {
    return vdom.H("recharts:ResponsiveContainer", map[string]any{
        "width":  "100%",
        "height": 350,
    },
        vdom.H("recharts:BarChart", map[string]any{
            "data": data,
        },
            vdom.H("recharts:CartesianGrid", map[string]any{
                "strokeDasharray": "3 3",
            }),
            vdom.H("recharts:XAxis", map[string]any{
                "dataKey": "time",
            }),
            vdom.H("recharts:YAxis", nil),
            vdom.H("recharts:Tooltip", nil),
            vdom.H("recharts:Legend", nil),
            vdom.H("recharts:Bar", map[string]any{
                "dataKey": "cpu",
                "fill":    "#8884d8",
                "name":    "CPU %",
            }),
            vdom.H("recharts:Bar", map[string]any{
                "dataKey": "mem",
                "fill":    "#82ca9d",
                "name":    "Memory %",
            }),
        ),
    )
}
```

## Live Data Updates

Charts automatically re-render when their data changes through Tsunami's reactive state system:

```go
var App = app.DefineComponent("App",
    func(_ struct{}) any {
        // State management
        chartData, setChartData, setChartDataFn := app.UseData[[]MetricsData]("metrics")

        // Timer for live updates
        app.UseEffect(func() func() {
            ticker := time.NewTicker(1 * time.Second)
            done := make(chan bool)

            go func() {
                for {
                    select {
                    case <-done:
                        return
                    case <-ticker.C:
                        // Update data and trigger re-render
                        setChartDataFn(func(current []MetricsData) []MetricsData {
                            newPoint := generateNewDataPoint()
                            updated := append(current, newPoint)
                            // Keep only last 20 points
                            if len(updated) > 20 {
                                updated = updated[1:]
                            }
                            return updated
                        })
                        app.SendAsyncInitiation() // This is necessary to force the FE to update
                    }
                }
            }()

            return func() {
                ticker.Stop()
                close(done)
            }
        }, []any{})

        return renderLineChart(chartData)
    },
)
```

## Responsive Design

### Container Sizing

Always use `ResponsiveContainer` for charts that should adapt to their container:

```go
// Responsive - adapts to parent container
vdom.H("recharts:ResponsiveContainer", map[string]any{
    "width":  "100%",
    "height": "100%",
})

// Fixed size
vdom.H("recharts:ResponsiveContainer", map[string]any{
    "width":  400,
    "height": 300,
})
```

### Mobile-Friendly Charts

Use Tailwind classes to create responsive chart layouts:

```go
vdom.H("div", map[string]any{
    "className": "w-full h-64 md:h-96 lg:h-[32rem]",
},
    vdom.H("recharts:ResponsiveContainer", map[string]any{
        "width":  "100%",
        "height": "100%",
    },
        // chart content
    ),
)
```

## Advanced Features

### Custom Styling

You can customize chart appearance through props:

```go
vdom.H("recharts:Tooltip", map[string]any{
    "labelStyle": map[string]any{
        "color": "#333",
    },
    "contentStyle": map[string]any{
        "backgroundColor": "#f8f9fa",
        "border": "1px solid #dee2e6",
    },
})
```

### Event Handling

Charts support interaction events:

```go
vdom.H("recharts:LineChart", map[string]any{
    "data": chartData,
    "onClick": func(event map[string]any) {
        // Handle chart click
        fmt.Printf("Chart clicked: %+v\n", event)
    },
})
```

## Best Practices

### Data Management

- Use global atoms (app.UseData) for chart data that updates frequently
- Implement data windowing for large datasets to maintain performance
- Structure data with appropriate json tags for clean field names

### Performance

- Limit data points for real-time charts (typically 20-100 points)
- Use app.UseEffect cleanup functions to prevent memory leaks with timers
- Consider data aggregation for historical views

### Styling

- Use consistent color schemes across charts
- Leverage Tailwind classes for chart containers and surrounding UI
- Consider dark/light theme support in color choices

### State Updates

- Use functional setters (`setDataFn`) for complex data transformations
- Call app.SendAsyncInitiation() after async state updates
- Implement proper cleanup in app.UseEffect for timers and goroutines

## Differences from React Recharts

1. **Namespace**: All components use `recharts:` prefix
2. **Props**: Pass as Go `map[string]any` instead of JSX props
3. **Data**: Use Go structs with json tags instead of JavaScript objects
4. **Events**: Event handlers receive Go types, not JavaScript events
5. **Styling**: Combine Recharts styling with Tailwind classes for layout

The core Recharts API remains the same - consult the official Recharts documentation for detailed prop references and advanced features. The Tsunami integration simply adapts the React patterns to Go's type system while maintaining the familiar development experience.
