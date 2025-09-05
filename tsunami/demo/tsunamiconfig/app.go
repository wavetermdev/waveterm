package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

type URLInputProps struct {
	Value     string       `json:"value"`
	OnChange  func(string) `json:"onChange"`
	OnSubmit  func()       `json:"onSubmit"`
	IsLoading bool         `json:"isLoading"`
}

type JSONEditorProps struct {
	Value       string       `json:"value"`
	OnChange    func(string) `json:"onChange"`
	OnSubmit    func()       `json:"onSubmit"`
	IsLoading   bool         `json:"isLoading"`
	Placeholder string       `json:"placeholder"`
}

type ErrorDisplayProps struct {
	Message string `json:"message"`
}

type SuccessDisplayProps struct {
	Message string `json:"message"`
}

// parseURL takes flexible URL input and returns a normalized base URL
func parseURL(input string) (string, error) {
	if input == "" {
		return "", fmt.Errorf("URL cannot be empty")
	}

	input = strings.TrimSpace(input)

	// Handle just port number (e.g., "52848")
	if portRegex := regexp.MustCompile(`^\d+$`); portRegex.MatchString(input) {
		return fmt.Sprintf("http://localhost:%s", input), nil
	}

	// Add http:// if no protocol specified
	if !strings.HasPrefix(input, "http://") && !strings.HasPrefix(input, "https://") {
		input = "http://" + input
	}

	// Parse the URL to validate and extract components
	parsedURL, err := url.Parse(input)
	if err != nil {
		return "", fmt.Errorf("invalid URL format: %v", err)
	}

	if parsedURL.Host == "" {
		return "", fmt.Errorf("no host specified in URL")
	}

	// Return base URL (scheme + host)
	baseURL := fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)
	return baseURL, nil
}

// fetchConfig fetches JSON from the /api/config endpoint
func fetchConfig(baseURL string) (string, error) {
	configURL := baseURL + "/api/config"

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(configURL)
	if err != nil {
		return "", fmt.Errorf("failed to connect to %s: %v", configURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("server returned status %d from %s", resp.StatusCode, configURL)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %v", err)
	}

	// Validate that it's valid JSON
	var jsonObj interface{}
	if err := json.Unmarshal(body, &jsonObj); err != nil {
		return "", fmt.Errorf("response is not valid JSON: %v", err)
	}

	// Pretty print the JSON
	prettyJSON, err := json.MarshalIndent(jsonObj, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to format JSON: %v", err)
	}

	return string(prettyJSON), nil
}

// postConfig sends JSON to the /api/config endpoint
func postConfig(baseURL, jsonContent string) error {
	configURL := baseURL + "/api/config"

	// Validate JSON before sending
	var jsonObj interface{}
	if err := json.Unmarshal([]byte(jsonContent), &jsonObj); err != nil {
		return fmt.Errorf("invalid JSON: %v", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(configURL, "application/json", strings.NewReader(jsonContent))
	if err != nil {
		return fmt.Errorf("failed to send request to %s: %v", configURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

var URLInput = app.DefineComponent("URLInput",
	func(ctx context.Context, props URLInputProps) any {
		keyHandler := &vdom.VDomFunc{
			Type: "func",
			Fn: func(event vdom.VDomEvent) {
				if !props.IsLoading {
					props.OnSubmit()
				}
			},
			Keys:           []string{"Enter"},
			PreventDefault: true,
		}

		return vdom.H("div", map[string]any{
			"className": "flex gap-2 mb-4",
		},
			vdom.H("input", map[string]any{
				"className":   "flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500",
				"type":        "text",
				"placeholder": "Enter URL (e.g., localhost:52848, http://localhost:52848/api/config, or just 52848)",
				"value":       props.Value,
				"disabled":    props.IsLoading,
				"onChange": func(e vdom.VDomEvent) {
					props.OnChange(e.TargetValue)
				},
				"onKeyDown": keyHandler,
			}),
			vdom.H("button", map[string]any{
				"className": vdom.Classes(
					"px-4 py-2 rounded font-medium cursor-pointer transition-colors",
					vdom.IfElse(props.IsLoading,
						"bg-slate-600 text-slate-400 cursor-not-allowed",
						"bg-blue-600 text-white hover:bg-blue-700",
					),
				),
				"onClick":  vdom.If(!props.IsLoading, props.OnSubmit),
				"disabled": props.IsLoading,
			}, vdom.IfElse(props.IsLoading, "Loading...", "Fetch")),
		)
	},
)

var JSONEditor = app.DefineComponent("JSONEditor",
	func(ctx context.Context, props JSONEditorProps) any {
		if props.Value == "" && props.Placeholder == "" {
			return vdom.H("div", map[string]any{
				"className": "text-slate-400 text-center py-8",
			}, "Enter a URL above and click Fetch to load configuration")
		}

		return vdom.H("div", map[string]any{
			"className": "flex flex-col",
		},
			vdom.H("textarea", map[string]any{
				"className":   "w-full h-96 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500",
				"value":       props.Value,
				"placeholder": props.Placeholder,
				"disabled":    props.IsLoading,
				"onChange": func(e vdom.VDomEvent) {
					props.OnChange(e.TargetValue)
				},
			}),
			vdom.If(props.Value != "",
				vdom.H("button", map[string]any{
					"className": vdom.Classes(
						"mt-2 w-full py-2 rounded font-medium cursor-pointer transition-colors",
						vdom.IfElse(props.IsLoading,
							"bg-slate-600 text-slate-400 cursor-not-allowed",
							"bg-green-600 text-white hover:bg-green-700",
						),
					),
					"onClick":  vdom.If(!props.IsLoading, props.OnSubmit),
					"disabled": props.IsLoading,
				}, vdom.IfElse(props.IsLoading, "Submitting...", "Submit Changes")),
			),
		)
	},
)

var ErrorDisplay = app.DefineComponent("ErrorDisplay",
	func(ctx context.Context, props ErrorDisplayProps) any {
		if props.Message == "" {
			return nil
		}

		return vdom.H("div", map[string]any{
			"className": "bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded mb-4",
		},
			vdom.H("div", map[string]any{
				"className": "font-medium",
			}, "Error"),
			vdom.H("div", map[string]any{
				"className": "text-sm mt-1",
			}, props.Message),
		)
	},
)

var SuccessDisplay = app.DefineComponent("SuccessDisplay",
	func(ctx context.Context, props SuccessDisplayProps) any {
		if props.Message == "" {
			return nil
		}

		return vdom.H("div", map[string]any{
			"className": "bg-green-900 border border-green-700 text-green-100 px-4 py-3 rounded mb-4",
		},
			vdom.H("div", map[string]any{
				"className": "font-medium",
			}, "Success"),
			vdom.H("div", map[string]any{
				"className": "text-sm mt-1",
			}, props.Message),
		)
	},
)

var App = app.DefineComponent("App",
	func(ctx context.Context, _ any) any {
		vdom.UseSetAppTitle(ctx, "Tsunami Config Manager")

		// Use UseConfig for the URL input so it persists
		urlInput, setURLInput, _ := vdom.UseConfig[string](ctx, "serverURL")
		jsonContent, setJSONContent, _ := vdom.UseState(ctx, "")
		errorMessage, setErrorMessage, _ := vdom.UseState(ctx, "")
		successMessage, setSuccessMessage, _ := vdom.UseState(ctx, "")
		isLoading, setIsLoading, _ := vdom.UseState(ctx, false)
		lastFetch, setLastFetch, _ := vdom.UseState(ctx, "")
		currentBaseURL, setCurrentBaseURL, _ := vdom.UseState(ctx, "")

		clearMessages := func() {
			setErrorMessage("")
			setSuccessMessage("")
		}

		fetchConfigData := func() {
			clearMessages()

			baseURL, err := parseURL(urlInput)
			if err != nil {
				setErrorMessage(err.Error())
				return
			}

			setIsLoading(true)
			setCurrentBaseURL(baseURL)

			go func() {
				defer func() {
					setIsLoading(false)
					app.SendAsyncInitiation()
				}()

				content, err := fetchConfig(baseURL)
				if err != nil {
					setErrorMessage(err.Error())
					return
				}

				setJSONContent(content)
				setLastFetch(time.Now().Format("2006-01-02 15:04:05"))
				setSuccessMessage(fmt.Sprintf("Successfully fetched config from %s", baseURL))
			}()
		}

		submitConfigData := func() {
			if currentBaseURL == "" {
				setErrorMessage("No base URL available. Please fetch config first.")
				return
			}

			clearMessages()
			setIsLoading(true)

			go func() {
				defer func() {
					setIsLoading(false)
					app.SendAsyncInitiation()
				}()

				err := postConfig(currentBaseURL, jsonContent)
				if err != nil {
					setErrorMessage(fmt.Sprintf("Failed to submit config: %v", err))
					return
				}

				setSuccessMessage(fmt.Sprintf("Successfully submitted config to %s", currentBaseURL))
			}()
		}

		return vdom.H("div", map[string]any{
			"className": "max-w-4xl mx-auto p-6 bg-slate-800 text-slate-100 min-h-screen",
		},
			vdom.H("div", map[string]any{
				"className": "mb-6",
			},
				vdom.H("h1", map[string]any{
					"className": "text-3xl font-bold mb-2",
				}, "Tsunami Config Manager"),
				vdom.H("p", map[string]any{
					"className": "text-slate-400",
				}, "Fetch and edit configuration from remote servers"),
			),

			URLInput(URLInputProps{
				Value:     urlInput,
				OnChange:  setURLInput,
				OnSubmit:  fetchConfigData,
				IsLoading: isLoading,
			}),

			ErrorDisplay(ErrorDisplayProps{
				Message: errorMessage,
			}),

			SuccessDisplay(SuccessDisplayProps{
				Message: successMessage,
			}),

			vdom.If(lastFetch != "",
				vdom.H("div", map[string]any{
					"className": "text-sm text-slate-400 mb-4",
				}, fmt.Sprintf("Last fetched: %s from %s", lastFetch, currentBaseURL)),
			),

			JSONEditor(JSONEditorProps{
				Value:       jsonContent,
				OnChange:    setJSONContent,
				OnSubmit:    submitConfigData,
				IsLoading:   isLoading,
				Placeholder: "JSON configuration will appear here after fetching...",
			}),
		)
	},
)
