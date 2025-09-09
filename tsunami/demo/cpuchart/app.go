package main

import (
	"log"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Global atoms for config and data
var (
	dataPointCountAtom = app.ConfigAtom("dataPointCount", 60)
	cpuDataAtom        = app.DataAtom("cpuData", func() []CPUDataPoint {
		// Initialize with empty data points to maintain consistent chart size
		dataPointCount := 60 // Default value for initialization
		initialData := make([]CPUDataPoint, dataPointCount)
		for i := range initialData {
			initialData[i] = CPUDataPoint{
				Time:      0,
				CPUUsage:  nil, // Use nil to represent empty slots
				Timestamp: "",
			}
		}
		return initialData
	}())
)

type CPUDataPoint struct {
	Time      int64    `json:"time"`      // Unix timestamp in seconds
	CPUUsage  *float64 `json:"cpuUsage"`  // CPU usage percentage (nil for empty slots)
	Timestamp string   `json:"timestamp"` // Human readable timestamp
}

func collectCPUUsage() (float64, error) {
	percentages, err := cpu.Percent(time.Second, false)
	if err != nil {
		return 0, err
	}
	if len(percentages) == 0 {
		return 0, nil
	}
	return percentages[0], nil
}

func generateCPUDataPoint() CPUDataPoint {
	now := time.Now()
	cpuUsage, err := collectCPUUsage()
	if err != nil {
		log.Printf("Error collecting CPU usage: %v", err)
		cpuUsage = 0
	}

	dataPoint := CPUDataPoint{
		Time:      now.Unix(),
		CPUUsage:  &cpuUsage, // Convert to pointer
		Timestamp: now.Format("15:04:05"),
	}

	log.Printf("CPU Usage: %.2f%% at %s", cpuUsage, dataPoint.Timestamp)
	return dataPoint
}

var StatsPanel = app.DefineComponent("StatsPanel",
	func(props struct {
		Data []CPUDataPoint `json:"data"`
	}) any {
		var currentUsage float64
		var avgUsage float64
		var maxUsage float64
		var validCount int

		if len(props.Data) > 0 {
			lastPoint := props.Data[len(props.Data)-1]
			if lastPoint.CPUUsage != nil {
				currentUsage = *lastPoint.CPUUsage
			}

			// Calculate average and max from non-nil values
			total := 0.0
			for _, point := range props.Data {
				if point.CPUUsage != nil {
					total += *point.CPUUsage
					validCount++
					if *point.CPUUsage > maxUsage {
						maxUsage = *point.CPUUsage
					}
				}
			}
			if validCount > 0 {
				avgUsage = total / float64(validCount)
			}
		}

		return vdom.H("div", map[string]any{
			"className": "bg-gray-800 rounded-lg p-4 mb-6",
		},
			vdom.H("h3", map[string]any{
				"className": "text-lg font-semibold text-white mb-3",
			}, "CPU Statistics"),
			vdom.H("div", map[string]any{
				"className": "grid grid-cols-3 gap-4",
			},
				// Current Usage
				vdom.H("div", map[string]any{
					"className": "bg-gray-700 rounded p-3",
				},
					vdom.H("div", map[string]any{
						"className": "text-sm text-gray-400 mb-1",
					}, "Current"),
					vdom.H("div", map[string]any{
						"className": "text-2xl font-bold text-blue-400",
					}, vdom.H("span", nil, int(currentUsage+0.5), "%")),
				),
				// Average Usage
				vdom.H("div", map[string]any{
					"className": "bg-gray-700 rounded p-3",
				},
					vdom.H("div", map[string]any{
						"className": "text-sm text-gray-400 mb-1",
					}, "Average"),
					vdom.H("div", map[string]any{
						"className": "text-2xl font-bold text-green-400",
					}, vdom.H("span", nil, int(avgUsage+0.5), "%")),
				),
				// Max Usage
				vdom.H("div", map[string]any{
					"className": "bg-gray-700 rounded p-3",
				},
					vdom.H("div", map[string]any{
						"className": "text-sm text-gray-400 mb-1",
					}, "Peak"),
					vdom.H("div", map[string]any{
						"className": "text-2xl font-bold text-red-400",
					}, vdom.H("span", nil, int(maxUsage+0.5), "%")),
				),
			),
		)
	},
)

var App = app.DefineComponent("App",
	func(_ struct{}) any {
		app.UseSetAppTitle("CPU Usage Monitor")

		// Local state for forcing re-renders
		_, _, setTickerFn := app.UseState(0)

		// Timer effect for continuous CPU data collection
		app.UseEffect(func() func() {
			ticker := time.NewTicker(1 * time.Second)
			done := make(chan bool)

			go func() {
				for {
					select {
					case <-done:
						return
					case <-ticker.C:
						// Collect new CPU data point and shift the data window
						cpuDataAtom.SetFn(func(currentData []CPUDataPoint) []CPUDataPoint {
							newPoint := generateCPUDataPoint()
							currentDataPointCount := dataPointCountAtom.Get()

							// Make a safe copy to avoid mutation issues
							data := app.DeepCopy(currentData)

							// Ensure we have the right size array
							if len(data) != currentDataPointCount {
								// Resize array if config changed
								resized := make([]CPUDataPoint, currentDataPointCount)
								copyCount := currentDataPointCount
								if len(data) < copyCount {
									copyCount = len(data)
								}
								if copyCount > 0 {
									copy(resized[currentDataPointCount-copyCount:], data[len(data)-copyCount:])
								}
								data = resized
							}

							// Append new point and keep only the last currentDataPointCount elements
							data = append(data, newPoint)
							if len(data) > currentDataPointCount {
								data = data[len(data)-currentDataPointCount:]
							}
							return data
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
		}, []any{})

		handleClear := func() {
			// Reset with empty data points based on current config
			currentDataPointCount := dataPointCountAtom.Get()
			initialData := make([]CPUDataPoint, currentDataPointCount)
			for i := range initialData {
				initialData[i] = CPUDataPoint{
					Time:      0,
					CPUUsage:  nil,
					Timestamp: "",
				}
			}
			cpuDataAtom.Set(initialData)
		}

		return vdom.H("div", map[string]any{
			"className": "min-h-screen bg-gray-900 text-white p-6",
		},
			vdom.H("div", map[string]any{
				"className": "max-w-6xl mx-auto",
			},
				// Header
				vdom.H("div", map[string]any{
					"className": "mb-8",
				},
					vdom.H("h1", map[string]any{
						"className": "text-3xl font-bold text-white mb-2",
					}, "Real-Time CPU Usage Monitor"),
					vdom.H("p", map[string]any{
						"className": "text-gray-400",
					}, "Live CPU usage data collected using gopsutil, displaying 60 seconds of history"),
				),

				// Controls
				vdom.H("div", map[string]any{
					"className": "bg-gray-800 rounded-lg p-4 mb-6",
				},
					vdom.H("div", map[string]any{
						"className": "flex items-center gap-4 flex-wrap",
					},
						// Clear button
						vdom.H("button", map[string]any{
							"className": "px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md text-sm font-medium transition-colors cursor-pointer",
							"onClick":   handleClear,
						}, "Clear Data"),

						// Status indicator
						vdom.H("div", map[string]any{
							"className": "flex items-center gap-2",
						},
							vdom.H("div", map[string]any{
								"className": "w-2 h-2 rounded-full bg-green-500",
							}),
							vdom.H("span", map[string]any{
								"className": "text-sm text-gray-400",
							}, "Live Monitoring"),
							vdom.H("span", map[string]any{
								"className": "text-sm text-gray-500 ml-2",
							}, "(", len(cpuDataAtom.Get()), "/", dataPointCountAtom.Get(), " data points)"),
						),
					),
				),

				// Statistics Panel
				StatsPanel(struct {
					Data []CPUDataPoint `json:"data"`
				}{
					Data: cpuDataAtom.Get(),
				}),

				// Main chart
				vdom.H("div", map[string]any{
					"className": "bg-gray-800 rounded-lg p-6 mb-6",
				},
					vdom.H("h2", map[string]any{
						"className": "text-xl font-semibold text-white mb-4",
					}, "CPU Usage Over Time"),
					vdom.H("div", map[string]any{
						"className": "w-full h-96",
					},
						vdom.H("recharts:ResponsiveContainer", map[string]any{
							"width":  "100%",
							"height": "100%",
						},
							vdom.H("recharts:LineChart", map[string]any{
								"data":              cpuDataAtom.Get(),
								"isAnimationActive": false,
							},
								vdom.H("recharts:CartesianGrid", map[string]any{
									"strokeDasharray": "3 3",
									"stroke":          "#374151",
								}),
								vdom.H("recharts:XAxis", map[string]any{
									"dataKey":  "timestamp",
									"stroke":   "#9CA3AF",
									"fontSize": 12,
								}),
								vdom.H("recharts:YAxis", map[string]any{
									"domain":   []int{0, 100},
									"stroke":   "#9CA3AF",
									"fontSize": 12,
								}),
								vdom.H("recharts:Tooltip", map[string]any{
									"labelStyle": map[string]any{
										"color": "#374151",
									},
									"contentStyle": map[string]any{
										"backgroundColor": "#1F2937",
										"border":          "1px solid #374151",
										"borderRadius":    "6px",
										"color":           "#F3F4F6",
									},
								}),
								vdom.H("recharts:Line", map[string]any{
									"type":              "monotone",
									"dataKey":           "cpuUsage",
									"stroke":            "#3B82F6",
									"strokeWidth":       2,
									"dot":               false,
									"name":              "CPU Usage (%)",
									"isAnimationActive": false,
								}),
							),
						),
					),
				),

				// Info section
				vdom.H("div", map[string]any{
					"className": "bg-blue-900 bg-opacity-50 border border-blue-700 rounded-lg p-4",
				},
					vdom.H("h3", map[string]any{
						"className": "text-lg font-semibold text-blue-200 mb-2",
					}, "Real-Time CPU Monitoring Features"),
					vdom.H("ul", map[string]any{
						"className": "space-y-2 text-blue-100",
					},
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Live CPU usage data collected using github.com/shirou/gopsutil/v4",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Continuous monitoring with 1-second update intervals",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Rolling window of 60 seconds of historical data",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Real-time statistics: current, average, and peak usage",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Dark theme optimized for Wave Terminal",
						),
					),
				),
			),
		)
	},
)
