package main

import (
	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const AppTitle = "Dropdown Test (Tsunami Demo)"
const AppShortDesc = "Test dropdown element in Tsunami"

// DropdownOption represents a single option in the dropdown
type DropdownOption struct {
	Label    string `json:"label"`
	Value    string `json:"value"`
	Disabled bool   `json:"disabled,omitempty"`
}

var App = app.DefineComponent("App", func(_ struct{}) any {
	// State for different dropdown values
	basicDropdown := app.UseLocal("option2")
	fruitDropdown := app.UseLocal("")
	colorDropdown := app.UseLocal("blue")
	disabledDropdown := app.UseLocal("disabled-value")

	// Options for different dropdowns
	basicOptions := []DropdownOption{
		{Label: "Option 1", Value: "option1"},
		{Label: "Option 2", Value: "option2"},
		{Label: "Option 3", Value: "option3"},
		{Label: "Option 4", Value: "option4"},
	}

	fruitOptions := []DropdownOption{
		{Label: "Apple 🍎", Value: "apple"},
		{Label: "Banana 🍌", Value: "banana"},
		{Label: "Cherry 🍒", Value: "cherry"},
		{Label: "Durian 🍈", Value: "durian", Disabled: true},
		{Label: "Elderberry 🫐", Value: "elderberry"},
		{Label: "Fig 🌰", Value: "fig"},
	}

	colorOptions := []DropdownOption{
		{Label: "Red", Value: "red"},
		{Label: "Green", Value: "green"},
		{Label: "Blue", Value: "blue"},
		{Label: "Yellow", Value: "yellow"},
		{Label: "Purple", Value: "purple"},
	}

	// Event handlers
	handleBasicChange := func(e vdom.VDomEvent) {
		basicDropdown.Set(e.TargetValue)
	}

	handleFruitChange := func(e vdom.VDomEvent) {
		fruitDropdown.Set(e.TargetValue)
	}

	handleColorChange := func(e vdom.VDomEvent) {
		colorDropdown.Set(e.TargetValue)
	}

	return vdom.H("div", map[string]any{
		"className": "max-w-4xl mx-auto p-8",
	},
		vdom.H("h1", map[string]any{
			"className": "text-3xl font-bold mb-6 text-white",
		}, "Tsunami Dropdown Test"),

		vdom.H("div", map[string]any{
			"className": "space-y-8",
		},
			// Basic Dropdown
			vdom.H("div", map[string]any{
				"className": "p-6 bg-gray-800 rounded-lg border border-gray-700",
			},
				vdom.H("h2", map[string]any{
					"className": "text-2xl font-semibold mb-4 text-white",
				}, "Basic Dropdown"),
				vdom.H("div", map[string]any{
					"className": "mb-4",
				},
					vdom.H("label", map[string]any{
						"className": "block text-gray-300 mb-2",
					}, "Select an option:"),
					vdom.H("wave:dropdown", map[string]any{
						"options":     basicOptions,
						"value":       basicDropdown.Get(),
						"placeholder": "Choose an option...",
						"onChange":    handleBasicChange,
					}),
				),
				vdom.H("div", map[string]any{
					"className": "mt-4 p-3 bg-gray-700 rounded text-gray-200",
				}, "Selected Value: ", basicDropdown.Get()),
			),

			// Fruit Dropdown with Disabled Option
			vdom.H("div", map[string]any{
				"className": "p-6 bg-gray-800 rounded-lg border border-gray-700",
			},
				vdom.H("h2", map[string]any{
					"className": "text-2xl font-semibold mb-4 text-white",
				}, "Dropdown with Icons and Disabled Option"),
				vdom.H("div", map[string]any{
					"className": "mb-4",
				},
					vdom.H("label", map[string]any{
						"className": "block text-gray-300 mb-2",
					}, "Pick a fruit (Durian is disabled):"),
					vdom.H("wave:dropdown", map[string]any{
						"options":     fruitOptions,
						"value":       fruitDropdown.Get(),
						"placeholder": "Select a fruit...",
						"onChange":    handleFruitChange,
					}),
				),
				vdom.H("div", map[string]any{
					"className": "mt-4 p-3 bg-gray-700 rounded text-gray-200",
				}, vdom.IfElse(
					fruitDropdown.Get() != "",
					"Selected Fruit: "+fruitDropdown.Get(),
					"No fruit selected",
				)),
			),

			// Color Dropdown with Pre-selected Value
			vdom.H("div", map[string]any{
				"className": "p-6 bg-gray-800 rounded-lg border border-gray-700",
			},
				vdom.H("h2", map[string]any{
					"className": "text-2xl font-semibold mb-4 text-white",
				}, "Dropdown with Default Value"),
				vdom.H("div", map[string]any{
					"className": "mb-4",
				},
					vdom.H("label", map[string]any{
						"className": "block text-gray-300 mb-2",
					}, "Choose your favorite color:"),
					vdom.H("wave:dropdown", map[string]any{
						"options":  colorOptions,
						"value":    colorDropdown.Get(),
						"onChange": handleColorChange,
					}),
				),
				vdom.H("div", map[string]any{
					"className": "mt-4 p-3 rounded text-gray-200",
					"style": map[string]any{
						"backgroundColor": colorDropdown.Get(),
					},
				}, "Selected Color: ", colorDropdown.Get()),
			),

			// Disabled Dropdown
			vdom.H("div", map[string]any{
				"className": "p-6 bg-gray-800 rounded-lg border border-gray-700",
			},
				vdom.H("h2", map[string]any{
					"className": "text-2xl font-semibold mb-4 text-white",
				}, "Disabled Dropdown"),
				vdom.H("div", map[string]any{
					"className": "mb-4",
				},
					vdom.H("label", map[string]any{
						"className": "block text-gray-300 mb-2",
					}, "This dropdown is disabled:"),
					vdom.H("wave:dropdown", map[string]any{
						"options":     basicOptions,
						"value":       disabledDropdown.Get(),
						"placeholder": "Can't select...",
						"disabled":    true,
					}),
				),
				vdom.H("div", map[string]any{
					"className": "mt-4 p-3 bg-gray-700 rounded text-gray-200",
				}, "This dropdown cannot be changed"),
			),

			// Custom Styled Dropdown
			vdom.H("div", map[string]any{
				"className": "p-6 bg-gray-800 rounded-lg border border-gray-700",
			},
				vdom.H("h2", map[string]any{
					"className": "text-2xl font-semibold mb-4 text-white",
				}, "Custom Styled Dropdown"),
				vdom.H("div", map[string]any{
					"className": "mb-4",
				},
					vdom.H("label", map[string]any{
						"className": "block text-gray-300 mb-2",
					}, "Dropdown with custom styling:"),
					vdom.H("wave:dropdown", map[string]any{
						"options":     colorOptions,
						"value":       colorDropdown.Get(),
						"onChange":    handleColorChange,
						"className":   "text-lg font-bold",
						"style": map[string]any{
							"borderWidth": "2px",
							"borderColor": "#10b981",
						},
					}),
				),
			),
		),
	)
})
