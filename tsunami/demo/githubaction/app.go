package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Global atoms for config and data
var (
	pollIntervalAtom    = app.ConfigAtom("pollInterval", 5)
	repositoryAtom      = app.ConfigAtom("repository", "wavetermdev/waveterm")
	workflowAtom        = app.ConfigAtom("workflow", "build-helper.yml")
	maxWorkflowRunsAtom = app.ConfigAtom("maxWorkflowRuns", 10)
	workflowRunsAtom    = app.DataAtom("workflowRuns", []WorkflowRun{})
	lastErrorAtom       = app.DataAtom("lastError", "")
	isLoadingAtom       = app.DataAtom("isLoading", true)
	lastRefreshTimeAtom = app.DataAtom("lastRefreshTime", time.Time{})
)

type WorkflowRun struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"`
	Conclusion string    `json:"conclusion"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	HTMLURL    string    `json:"html_url"`
	RunNumber  int       `json:"run_number"`
}

type GitHubResponse struct {
	TotalCount   int           `json:"total_count"`
	WorkflowRuns []WorkflowRun `json:"workflow_runs"`
}

func fetchWorkflowRuns(repository, workflow string, maxRuns int) ([]WorkflowRun, error) {
	apiKey := os.Getenv("GITHUB_APIKEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GITHUB_APIKEY environment variable not set")
	}

	url := fmt.Sprintf("https://api.github.com/repos/%s/actions/workflows/%s/runs?per_page=%d", repository, workflow, maxRuns)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "WaveTerminal-GitHubMonitor")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var response GitHubResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return response.WorkflowRuns, nil
}

func getStatusIcon(status, conclusion string) string {
	switch status {
	case "in_progress", "queued", "pending":
		return "🔄"
	case "completed":
		switch conclusion {
		case "success":
			return "✅"
		case "failure":
			return "❌"
		case "cancelled":
			return "🚫"
		case "skipped":
			return "⏭️"
		default:
			return "❓"
		}
	default:
		return "❓"
	}
}

func getStatusColor(status, conclusion string) string {
	switch status {
	case "in_progress", "queued", "pending":
		return "text-yellow-400"
	case "completed":
		switch conclusion {
		case "success":
			return "text-green-400"
		case "failure":
			return "text-red-400"
		case "cancelled":
			return "text-gray-400"
		case "skipped":
			return "text-blue-400"
		default:
			return "text-gray-400"
		}
	default:
		return "text-gray-400"
	}
}

func formatDuration(start, end time.Time, isRunning bool) string {
	if isRunning {
		duration := time.Since(start)
		return fmt.Sprintf("%v (running)", duration.Round(time.Second))
	}
	if end.IsZero() {
		return "Unknown"
	}
	duration := end.Sub(start)
	return duration.Round(time.Second).String()
}

func getDisplayStatus(status, conclusion string) string {
	switch status {
	case "in_progress":
		return "Running"
	case "queued":
		return "Queued"
	case "pending":
		return "Pending"
	case "completed":
		switch conclusion {
		case "success":
			return "Success"
		case "failure":
			return "Failed"
		case "cancelled":
			return "Cancelled"
		case "skipped":
			return "Skipped"
		default:
			return "Completed"
		}
	default:
		return status
	}
}

type WorkflowRunItemProps struct {
	Run WorkflowRun `json:"run"`
}

var WorkflowRunItem = app.DefineComponent("WorkflowRunItem",
	func(ctx context.Context, props WorkflowRunItemProps) any {
		run := props.Run
		isRunning := run.Status == "in_progress" || run.Status == "queued" || run.Status == "pending"

		return vdom.H("div", map[string]any{
			"className": "bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors",
		},
			vdom.H("div", map[string]any{
				"className": "flex items-start justify-between",
			},
				vdom.H("div", map[string]any{
					"className": "flex-1 min-w-0",
				},
					vdom.H("div", map[string]any{
						"className": "flex items-center gap-3 mb-2",
					},
						vdom.H("span", map[string]any{
							"className": "text-2xl",
						}, getStatusIcon(run.Status, run.Conclusion)),
						vdom.H("a", map[string]any{
							"href":      run.HTMLURL,
							"target":    "_blank",
							"className": "font-semibold text-blue-400 hover:text-blue-300 cursor-pointer",
						}, run.Name),
						vdom.H("span", map[string]any{
							"className": "text-sm text-gray-300",
						}, "#", run.RunNumber),
					),
					vdom.H("div", map[string]any{
						"className": "flex items-center gap-4 text-sm",
					},
						vdom.H("span", map[string]any{
							"className": vdom.Classes("font-medium", getStatusColor(run.Status, run.Conclusion)),
						}, getDisplayStatus(run.Status, run.Conclusion)),
						vdom.H("span", map[string]any{
							"className": "text-gray-400",
						}, "Duration: ", formatDuration(run.CreatedAt, run.UpdatedAt, isRunning)),
						vdom.H("span", map[string]any{
							"className": "text-gray-300",
						}, "Started: ", run.CreatedAt.Format("15:04:05")),
					),
				),
			),
		)
	},
)

var App = app.DefineComponent("App",
	func(ctx context.Context, _ struct{}) any {
		vdom.UseSetAppTitle(ctx, "GitHub Actions Monitor")

		workflowRuns, setWorkflowRuns, _ := vdom.UseAtom[[]WorkflowRun](ctx, workflowRunsAtom)
		lastError, setLastError, _ := vdom.UseAtom[string](ctx, lastErrorAtom)
		isLoading, setIsLoading, _ := vdom.UseAtom[bool](ctx, isLoadingAtom)
		lastRefreshTime, setLastRefreshTime, _ := vdom.UseAtom[time.Time](ctx, lastRefreshTimeAtom)
		pollInterval, _, _ := vdom.UseAtom[int](ctx, pollIntervalAtom)
		repository, _, _ := vdom.UseAtom[string](ctx, repositoryAtom)
		workflow, _, _ := vdom.UseAtom[string](ctx, workflowAtom)
		maxWorkflowRuns, _, _ := vdom.UseAtom[int](ctx, maxWorkflowRunsAtom)

		_, _, setTickerFn := vdom.UseState[int](ctx, 0)

		vdom.UseEffect(ctx, func() func() {
			ticker := time.NewTicker(time.Duration(pollInterval) * time.Second)
			done := make(chan bool)

			fetchData := func() {
				currentMaxRuns := maxWorkflowRunsAtom.Get()
				runs, err := fetchWorkflowRuns(repository, workflow, currentMaxRuns)
				if err != nil {
					log.Printf("Error fetching workflow runs: %v", err)
					setLastError(err.Error())
				} else {
					sort.Slice(runs, func(i, j int) bool {
						return runs[i].CreatedAt.After(runs[j].CreatedAt)
					})
					setWorkflowRuns(runs)
					setLastError("")
				}
				setLastRefreshTime(time.Now())
				setIsLoading(false)
			}

			fetchData()

			go func() {
				for {
					select {
					case <-done:
						return
					case <-ticker.C:
						fetchData()
						setTickerFn(func(t int) int { return t + 1 })
						app.SendAsyncInitiation()
					}
				}
			}()

			return func() {
				ticker.Stop()
				close(done)
			}
		}, []any{pollInterval})

		handleRefresh := func() {
			setIsLoading(true)
			go func() {
				currentMaxRuns := maxWorkflowRunsAtom.Get()
				runs, err := fetchWorkflowRuns(repository, workflow, currentMaxRuns)
				if err != nil {
					log.Printf("Error fetching workflow runs: %v", err)
					setLastError(err.Error())
				} else {
					sort.Slice(runs, func(i, j int) bool {
						return runs[i].CreatedAt.After(runs[j].CreatedAt)
					})
					setWorkflowRuns(runs)
					setLastError("")
				}
				setLastRefreshTime(time.Now())
				setIsLoading(false)
				app.SendAsyncInitiation()
			}()
		}

		return vdom.H("div", map[string]any{
			"className": "min-h-screen bg-gray-900 text-white p-6",
		},
			vdom.H("div", map[string]any{
				"className": "max-w-6xl mx-auto",
			},
				vdom.H("div", map[string]any{
					"className": "mb-8",
				},
					vdom.H("h1", map[string]any{
						"className": "text-3xl font-bold text-white mb-2",
					}, "GitHub Actions Monitor"),
					vdom.H("p", map[string]any{
						"className": "text-gray-400",
					}, "Monitoring ", repository, " ", workflow, " workflow"),
				),

				vdom.H("div", map[string]any{
					"className": "bg-gray-800 rounded-lg p-4 mb-6",
				},
					vdom.H("div", map[string]any{
						"className": "flex items-center justify-between",
					},
						vdom.H("div", map[string]any{
							"className": "flex items-center gap-4",
						},
							vdom.H("button", map[string]any{
								"className": vdom.Classes(
									"px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
									vdom.IfElse(isLoading, "bg-gray-600 text-gray-400", "bg-blue-600 hover:bg-blue-700 text-white"),
								),
								"onClick":  vdom.If(!isLoading, handleRefresh),
								"disabled": isLoading,
							}, vdom.IfElse(isLoading, "Refreshing...", "Refresh")),

							vdom.H("div", map[string]any{
								"className": "flex items-center gap-2",
							},
								vdom.H("div", map[string]any{
									"className": vdom.Classes("w-2 h-2 rounded-full", vdom.IfElse(lastError == "", "bg-green-500", "bg-red-500")),
								}),
								vdom.H("span", map[string]any{
									"className": "text-sm text-gray-400",
								}, vdom.IfElse(lastError == "", "Connected", "Error")),
								vdom.H("span", map[string]any{
									"className": "text-sm text-gray-300 ml-2",
								}, "Poll interval: ", pollInterval, "s"),
								vdom.If(!lastRefreshTime.IsZero(),
									vdom.H("span", map[string]any{
										"className": "text-sm text-gray-300 ml-4",
									}, "Last refresh: ", lastRefreshTime.Format("15:04:05")),
								),
							),
						),
						vdom.H("div", map[string]any{
							"className": "text-sm text-gray-300",
						}, "Last ", maxWorkflowRuns, " workflow runs"),
					),
				),

				vdom.If(lastError != "",
					vdom.H("div", map[string]any{
						"className": "bg-red-900 bg-opacity-50 border border-red-700 rounded-lg p-4 mb-6",
					},
						vdom.H("div", map[string]any{
							"className": "flex items-center gap-2 text-red-200",
						},
							vdom.H("span", nil, "❌"),
							vdom.H("strong", nil, "Error:"),
						),
						vdom.H("p", map[string]any{
							"className": "text-red-100 mt-1",
						}, lastError),
					),
				),

				vdom.H("div", map[string]any{
					"className": "space-y-4",
				},
					vdom.If(isLoading && len(workflowRuns) == 0,
						vdom.H("div", map[string]any{
							"className": "text-center py-8 text-gray-400",
						}, "Loading workflow runs..."),
					),
					vdom.If(len(workflowRuns) > 0,
						vdom.ForEach(workflowRuns, func(run WorkflowRun, idx int) any {
							return WorkflowRunItem(WorkflowRunItemProps{
								Run: run,
							}).WithKey(strconv.FormatInt(run.ID, 10))
						}),
					),
					vdom.If(!isLoading && len(workflowRuns) == 0 && lastError == "",
						vdom.H("div", map[string]any{
							"className": "text-center py-8 text-gray-400",
						}, "No workflow runs found"),
					),
				),

				vdom.H("div", map[string]any{
					"className": "mt-8 bg-blue-900 bg-opacity-50 border border-blue-700 rounded-lg p-4",
				},
					vdom.H("h3", map[string]any{
						"className": "text-lg font-semibold text-blue-200 mb-2",
					}, "GitHub Actions Monitor Features"),
					vdom.H("ul", map[string]any{
						"className": "space-y-2 text-blue-100",
					},
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Monitors ", repository, " ", workflow, " workflow",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Polls GitHub API every 5 seconds for real-time updates",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Shows status icons: ✅ Success, ❌ Failure, 🔄 Running",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Clickable workflow names open in GitHub (new tab)",
						),
						vdom.H("li", map[string]any{
							"className": "flex items-start gap-2",
						},
							vdom.H("span", map[string]any{
								"className": "text-blue-400 mt-1",
							}, "•"),
							"Live duration tracking for running jobs",
						),
					),
				),
			),
		)
	},
)
