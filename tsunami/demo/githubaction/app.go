package main

import (
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

var AppMeta = app.AppMeta{
	Title:     "GitHub Actions Monitor",
	ShortDesc: "Real-time GitHub Actions workflow monitoring and status tracking",
}

// Global atoms for config and data
var (
	pollIntervalAtom = app.ConfigAtom("pollInterval", 5, &app.AtomMeta{
		Desc:  "Polling interval for GitHub API requests",
		Units: "s",
		Min:   app.Ptr(1.0),
		Max:   app.Ptr(300.0),
	})
	repositoryAtom = app.ConfigAtom("repository", "wavetermdev/waveterm", &app.AtomMeta{
		Desc:    "GitHub repository in owner/repo format",
		Pattern: `^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$`,
	})
	workflowAtom = app.ConfigAtom("workflow", "build-helper.yml", &app.AtomMeta{
		Desc:    "GitHub Actions workflow file name",
		Pattern: `^.+\.(yml|yaml)$`,
	})
	maxWorkflowRunsAtom = app.ConfigAtom("maxWorkflowRuns", 10, &app.AtomMeta{
		Desc: "Maximum number of workflow runs to fetch",
		Min:  app.Ptr(1.0),
		Max:  app.Ptr(100.0),
	})
	workflowRunsAtom = app.DataAtom("workflowRuns", []WorkflowRun{}, &app.AtomMeta{
		Desc: "List of GitHub Actions workflow runs",
	})
	lastErrorAtom = app.DataAtom("lastError", "", &app.AtomMeta{
		Desc: "Last error message from GitHub API",
	})
	isLoadingAtom = app.DataAtom("isLoading", true, &app.AtomMeta{
		Desc: "Loading state for workflow data fetch",
	})
	lastRefreshTimeAtom = app.DataAtom("lastRefreshTime", time.Time{}, &app.AtomMeta{
		Desc: "Timestamp of last successful data refresh",
	})
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
	func(props WorkflowRunItemProps) any {
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
	func(_ struct{}) any {

		fetchData := func() {
			currentMaxRuns := maxWorkflowRunsAtom.Get()
			runs, err := fetchWorkflowRuns(repositoryAtom.Get(), workflowAtom.Get(), currentMaxRuns)
			if err != nil {
				log.Printf("Error fetching workflow runs: %v", err)
				lastErrorAtom.Set(err.Error())
			} else {
				sort.Slice(runs, func(i, j int) bool {
					return runs[i].CreatedAt.After(runs[j].CreatedAt)
				})
				workflowRunsAtom.Set(runs)
				lastErrorAtom.Set("")
			}
			lastRefreshTimeAtom.Set(time.Now())
			isLoadingAtom.Set(false)
		}

		// Initial fetch on mount
		app.UseEffect(func() func() {
			fetchData()
			return nil
		}, []any{})

		// Automatic polling with UseTicker - automatically cleaned up on unmount
		app.UseTicker(time.Duration(pollIntervalAtom.Get())*time.Second, func() {
			fetchData()
		}, []any{pollIntervalAtom.Get()})

		handleRefresh := func() {
			isLoadingAtom.Set(true)
			go func() {
				fetchData()
			}()
		}

		workflowRuns := workflowRunsAtom.Get()
		lastError := lastErrorAtom.Get()
		isLoading := isLoadingAtom.Get()
		lastRefreshTime := lastRefreshTimeAtom.Get()
		pollInterval := pollIntervalAtom.Get()
		repository := repositoryAtom.Get()
		workflow := workflowAtom.Get()
		maxWorkflowRuns := maxWorkflowRunsAtom.Get()

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
					}, "Monitoring ", repositoryAtom.Get(), " ", workflowAtom.Get(), " workflow"),
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
									vdom.IfElse(isLoadingAtom.Get(), "bg-gray-600 text-gray-400", "bg-blue-600 hover:bg-blue-700 text-white"),
								),
								"onClick":  vdom.If(!isLoadingAtom.Get(), handleRefresh),
								"disabled": isLoadingAtom.Get(),
							}, vdom.IfElse(isLoadingAtom.Get(), "Refreshing...", "Refresh")),

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
							"Polls GitHub API every ", pollInterval, " seconds for real-time updates",
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
