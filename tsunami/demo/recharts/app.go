package main

import (
	"context"
	"math"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Use func init() to set atom defaults
func init() {
	app.SetData("chartData", generateInitialData())
	app.SetConfig("chartType", "line")
	app.SetSharedAtom("isAnimating", false)
}

type DataPoint struct {
	Time int     `json:"time"`
	CPU  float64 `json:"cpu"`
	Mem  float64 `json:"mem"`
	Disk float64 `json:"disk"`
}

func generateInitialData() []DataPoint {
	data := make([]DataPoint, 20)
	for i := 0; i < 20; i++ {
		data[i] = DataPoint{
			Time: i,
			CPU:  50 + 30*math.Sin(float64(i)*0.3) + 10*math.Sin(float64(i)*0.7),
			Mem:  40 + 25*math.Cos(float64(i)*0.4) + 15*math.Sin(float64(i)*0.9),
			Disk: 30 + 20*math.Sin(float64(i)*0.2) + 10*math.Cos(float64(i)*1.1),
		}
	}
	return data
}

func generateNewDataPoint(currentData []DataPoint) DataPoint {
	lastTime := 0
	if len(currentData) > 0 {
		lastTime = currentData[len(currentData)-1].Time
	}
	newTime := lastTime + 1
	
	return DataPoint{
		Time: newTime,
		CPU:  50 + 30*math.Sin(float64(newTime)*0.3) + 10*math.Sin(float64(newTime)*0.7),
		Mem:  40 + 25*math.Cos(float64(newTime)*0.4) + 15*math.Sin(float64(newTime)*0.9),
		Disk: 30 + 20*math.Sin(float64(newTime)*0.2) + 10*math.Cos(float64(newTime)*1.1),
	}
}

var App = app.DefineComponent("App",
	func(ctx context.Context, _ struct{}) any {
		vdom.UseSetAppTitle(ctx, "Recharts Demo")

		// Global state
		chartData, setChartData, setChartDataFn := vdom.UseData[[]DataPoint](ctx, "chartData")
		chartType, setChartType, _ := vdom.UseConfig[string](ctx, "chartType")
		isAnimating, setIsAnimating, _ := vdom.UseSharedAtom[bool](ctx, "isAnimating")

		// Local state for timer
		_, _, setTickerFn := vdom.UseState[int](ctx, 0)

		// Timer effect for live data updates
		vdom.UseEffect(ctx, func() func() {
			if !isAnimating {
				return nil
			}

			ticker := time.NewTicker(1 * time.Second)
			done := make(chan bool)

			go func() {
				for {
					select {
					case <-done:
						return
					case <-ticker.C:
						// Add new data point and keep only last 20 points
						setChartDataFn(func(currentData []DataPoint) []DataPoint {
							newData := append(currentData, generateNewDataPoint(currentData))
							if len(newData) > 20 {
								newData = newData[1:]
							}
							return newData
						})
						// Trigger a re-render
						setTickerFn(func(t int) int { return t + 1 })
						app.SendAsyncInitiation()
					}
				}
			}()

			return func() {
				ticker.Stop()
				close(done)
			}
		}, []any{isAnimating})

		handleStartStop := func() {
			setIsAnimating(!isAnimating)
		}

		handleReset := func() {
			setChartData(generateInitialData())
			setIsAnimating(false)
		}

		handleChartTypeChange := func(newType string) {
			setChartType(newType)
		}

		return vdom.H("div", map[string]any{
			"className": "min-h-screen bg-gray-50 p-6",
		},
			vdom.H("div", map[string]any{
				"className": "max-w-6xl mx-auto",
			},
				// Header
				vdom.H("div", map[string]any{
					"className": "mb-8",
				},
					vdom.H("h1", map[string]any{
						"className": "text-3xl font-bold text-gray-900 mb-2",
					}, "Recharts Integration Demo"),
					vdom.H("p", map[string]any{
						"className": "text-gray-600",
					}, "Demonstrating recharts components in Tsunami VDOM system"),
				),

				// Controls
				vdom.H("div", map[string]any{
					"className": "bg-white rounded-lg shadow-sm border p-4 mb-6",
				},
					vdom.H("div", map[string]any{
						"className": "flex items-center gap-4 flex-wrap",
					},
						// Chart type selector
						vdom.H("div", map[string]any{
							"className": "flex items-center gap-2",
						},
							vdom.H("label", map[string]any{
								"className": "text-sm font-medium text-gray-700",
							}, "Chart Type:"),
							vdom.H("select", map[string]any{
								"className": "px-3 py-1 border border-gray-300 rounded-md text-sm bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
								"value":     chartType,
								"onChange": func(e vdom.VDomEvent) {
									handleChartTypeChange(e.TargetValue)
								},
							},
								vdom.H("option", map[string]any{"value": "line"}, "Line Chart"),
								vdom.H("option", map[string]any{"value": "area"}, "Area Chart"),
								vdom.H("option", map[string]any{"value": "bar"}, "Bar Chart"),
							),
						),

						// Animation controls
						vdom.H("button", map[string]any{
							"className": vdom.Classes(
								"px-4 py-2 rounded-md text-sm font-medium transition-colors",
								vdom.IfElse(isAnimating,
									"bg-red-500 hover:bg-red-600 text-white",
									"bg-green-500 hover:bg-green-600 text-white",
								),
							),
							"onClick": handleStartStop,
						}, vdom.IfElse(isAnimating, "Stop Animation", "Start Animation")),

						vdom.H("button", map[string]any{
							"className": "px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md text-sm font-medium transition-colors",
							"onClick":   handleReset,
						}, "Reset Data"),

						// Status indicator
						vdom.H("div", map[string]any{
							"className": "flex items-center gap-2",
						},
							vdom.H("div", map[string]any{
								"className": vdom.Classes(
									"w-2 h-2 rounded-full",
									vdom.IfElse(isAnimating, "bg-green-500", "bg-gray-400"),
								),
							}),
							vdom.H("span", map[string]any{
								"className": "text-sm text-gray-600",
							}, vdom.IfElse(isAnimating, "Live Updates", "Static")),
						),
					),
				),

				// Main chart
				vdom.H("div", map[string]any{
					"className": "bg-white rounded-lg shadow-sm border p-6 mb-6",
				},
					vdom.H("h2", map[string]any{
						"className": "text-xl font-semibold text-gray-900 mb-4",
					}, "System Metrics Over Time"),
					vdom.H("div", map[string]any{
						"className": "w-full h-96",
					},
						// Main chart - switches based on chartType
						vdom.IfElse(chartType == "line",
							// Line Chart
							vdom.H("recharts:ResponsiveContainer", map[string]any{
								"width":  "100%",
								"height": "100%",
							},
								vdom.H("recharts:LineChart", map[string]any{
									"data": chartData,
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
										"type":     "monotone",
										"dataKey":  "cpu",
										"stroke":   "#8884d8",
										"name":     "CPU %",
									}),
									vdom.H("recharts:Line", map[string]any{
										"type":     "monotone",
										"dataKey":  "mem",
										"stroke":   "#82ca9d",
										"name":     "Memory %",
									}),
									vdom.H("recharts:Line", map[string]any{
										"type":     "monotone",
										"dataKey":  "disk",
										"stroke":   "#ffc658",
										"name":     "Disk %",
									}),
								),
							),
							vdom.IfElse(chartType == "area",
								// Area Chart
								vdom.H("recharts:ResponsiveContainer", map[string]any{
									"width":  "100%",
									"height": "100%",
								},
									vdom.H("recharts:AreaChart", map[string]any{
										"data": chartData,
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
										vdom.H("recharts:Area", map[string]any{
											"type":     "monotone",
											"dataKey":  "cpu",
											"stackId":  "1",
											"stroke":   "#8884d8",
											"fill":     "#8884d8",
											"name":     "CPU %",
										}),
										vdom.H("recharts:Area", map[string]any{
											"type":     "monotone",
											"dataKey":  "mem",
											"stackId":  "1",
											"stroke":   "#82ca9d",
											"fill":     "#82ca9d",
											"name":     "Memory %",
										}),
										vdom.H("recharts:Area", map[string]any{
											"type":     "monotone",
											"dataKey":  "disk",
											"stackId":  "1",
											"stroke":   "#ffc658",
											"fill":     "#ffc658",
											"name":     "Disk %",
										}),
									),
								),
								// Bar Chart
								vdom.H("recharts:ResponsiveContainer", map[string]any{
									"width":  "100%",
									"height": "100%",
								},
									vdom.H("recharts:BarChart", map[string]any{
										"data": chartData,
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
										vdom.H("recharts:Bar", map[string]any{
											"dataKey": "disk",
											"fill":    "#ffc658",
											"name":    "Disk %",
										}),
									),
								),
							),
						),
					),
				),

				// Mini charts row
				vdom.H("div", map[string]any{
					"className": "grid grid-cols-1 md:grid-cols-3 gap-6 mb-6",
				},
					// CPU Mini Chart
					vdom.H("div", map[string]any{
						"className": "bg-white rounded-lg shadow-sm border p-4",
					},
						vdom.H("h3", map[string]any{
							"className": "text-lg font-medium text-gray-900 mb-3",
						}, "CPU Usage"),
						vdom.H("div", map[string]any{
							"className": "h-32",
						},
							vdom.H("recharts:ResponsiveContainer", map[string]any{
								"width":  "100%",
								"height": "100%",
							},
								vdom.H("recharts:LineChart", map[string]any{
									"data": chartData,
								},
									vdom.H("recharts:Line", map[string]any{
										"type":            "monotone",
										"dataKey":         "cpu",
										"stroke":          "#8884d8",
										"strokeWidth":     2,
										"dot":             false,
									}),
								),
							),
						),
					),

					// Memory Mini Chart
					vdom.H("div", map[string]any{
						"className": "bg-white rounded-lg shadow-sm border p-4",
					},
						vdom.H("h3", map[string]any{
							"className": "text-lg font-medium text-gray-900 mb-3",
						}, "Memory Usage"),
						vdom.H("div", map[string]any{
							"className": "h-32",
						},
							vdom.H("recharts:ResponsiveContainer", map[string]any{
								"width":  "100%",
								"height": "100%",
							},
								vdom.H("recharts:AreaChart", map[string]any{
									"data": chartData,
								},
									vdom.H("recharts:Area", map[string]any{
										"type":    "monotone",
										"dataKey": "mem",
										"stroke":  "#82ca9d",
										"fill":    "#82ca9d",
									}),
								),
							),
						),
					),

					// Disk Mini Chart  
					vdom.H("div", map[string]any{
						"className": "bg-white rounded-lg shadow-sm border p-4",
					},
						vdom.H("h3", map[string]any{
							"className": "text-lg font-medium text-gray-900 mb-3",
						}, "Disk Usage"),
						vdom.H("div", map[string]any{
							"className": "h-32",
						},
							vdom.H("recharts:ResponsiveContainer", map[string]any{
								"width":  "100%",
								"height": "100%",
							},
								vdom.H("recharts:BarChart", map[string]any{
									"data": chartData,
								},
									vdom.H("recharts:Bar", map[string]any{
										"dataKey": "disk",
										"fill":    "#ffc658",
									}),
								),
							),
						),
					),
				),

				// Info section
				vdom.H("div", map[string]any{
					"className": "bg-blue-50 border border-blue-200 rounded-lg p-4",
				},
					vdom.H("h3", map[string]any{
						"className": "text-lg font-semibold text-blue-900 mb-2",
					}, "Recharts Integration Features"),
					vdom.H("ul", map[string]any{
						"className": "space-y-2 text-blue-800",
					},
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-500 mt-1",
							}, "•"),
							"Support for all major Recharts components (LineChart, AreaChart, BarChart, etc.)",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-500 mt-1",
							}, "•"),
							"Live data updates with animation support",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-500 mt-1",
							}, "•"),
							"Responsive containers that resize with the window",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-500 mt-1",
							}, "•"),
							"Full prop support for customization and styling",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-500 mt-1",
							}, "•"),
							"Uses recharts: namespace to dispatch to the recharts handler",
						),
					),
				),
			),
		)
	},
)
