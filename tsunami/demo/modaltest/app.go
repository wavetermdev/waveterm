package main

import (
	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

var AppMeta = app.AppMeta{
	Title:     "Modal Test (Tsunami Demo)",
	ShortDesc: "Test alert and confirm modals in Tsunami",
}

var App = app.DefineComponent("App", func(_ struct{}) any {
	// State to track modal results
	alertResult := app.UseLocal("")
	confirmResult := app.UseLocal("")

	// Hook for alert modal
	alertOpen, triggerAlert := app.UseAlertModal()

	// Hook for confirm modal
	confirmOpen, triggerConfirm := app.UseConfirmModal()

	// Event handlers for alert
	handleShowAlert := func() {
		triggerAlert(app.ModalConfig{
			Icon:  "⚠️",
			Title: "Alert Message",
			Text:  "This is an alert modal. Click OK to dismiss.",
			OnClose: func() {
				alertResult.Set("Alert dismissed")
			},
		})
	}

	handleShowAlertSimple := func() {
		triggerAlert(app.ModalConfig{
			Title: "Simple Alert",
			Text:  "This alert has no icon and custom OK text.",
			OkText: "Got it!",
			OnClose: func() {
				alertResult.Set("Simple alert dismissed")
			},
		})
	}

	// Event handlers for confirm
	handleShowConfirm := func() {
		triggerConfirm(app.ModalConfig{
			Icon:  "❓",
			Title: "Confirm Action",
			Text:  "Do you want to proceed with this action?",
			OnResult: func(confirmed bool) {
				if confirmed {
					confirmResult.Set("User confirmed the action")
				} else {
					confirmResult.Set("User cancelled the action")
				}
			},
		})
	}

	handleShowConfirmCustom := func() {
		triggerConfirm(app.ModalConfig{
			Icon:       "🗑️",
			Title:      "Delete Item",
			Text:       "Are you sure you want to delete this item? This action cannot be undone.",
			OkText:     "Delete",
			CancelText: "Keep",
			OnResult: func(confirmed bool) {
				if confirmed {
					confirmResult.Set("Item deleted")
				} else {
					confirmResult.Set("Item kept")
				}
			},
		})
	}

	// Read state values
	currentAlertResult := alertResult.Get()
	currentConfirmResult := confirmResult.Get()

	return vdom.H("div", map[string]any{
		"className": "max-w-4xl mx-auto p-8",
	},
		vdom.H("h1", map[string]any{
			"className": "text-3xl font-bold mb-6 text-white",
		}, "Tsunami Modal Test"),

		// Alert Modal Section
		vdom.H("div", map[string]any{
			"className": "mb-8 p-6 bg-gray-800 rounded-lg border border-gray-700",
		},
			vdom.H("h2", map[string]any{
				"className": "text-2xl font-semibold mb-4 text-white",
			}, "Alert Modals"),
			vdom.H("div", map[string]any{
				"className": "flex gap-4 mb-4",
			},
				vdom.H("button", map[string]any{
					"className": "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed",
					"onClick":   handleShowAlert,
					"disabled":  alertOpen,
				}, "Show Alert with Icon"),
				vdom.H("button", map[string]any{
					"className": "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed",
					"onClick":   handleShowAlertSimple,
					"disabled":  alertOpen,
				}, "Show Simple Alert"),
			),
			vdom.If(currentAlertResult != "", vdom.H("div", map[string]any{
				"className": "mt-4 p-3 bg-gray-700 rounded text-gray-200",
			}, "Result: ", currentAlertResult)),
		),

		// Confirm Modal Section
		vdom.H("div", map[string]any{
			"className": "mb-8 p-6 bg-gray-800 rounded-lg border border-gray-700",
		},
			vdom.H("h2", map[string]any{
				"className": "text-2xl font-semibold mb-4 text-white",
			}, "Confirm Modals"),
			vdom.H("div", map[string]any{
				"className": "flex gap-4 mb-4",
			},
				vdom.H("button", map[string]any{
					"className": "px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed",
					"onClick":   handleShowConfirm,
					"disabled":  confirmOpen,
				}, "Show Confirm Modal"),
				vdom.H("button", map[string]any{
					"className": "px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed",
					"onClick":   handleShowConfirmCustom,
					"disabled":  confirmOpen,
				}, "Show Delete Confirm"),
			),
			vdom.If(currentConfirmResult != "", vdom.H("div", map[string]any{
				"className": "mt-4 p-3 bg-gray-700 rounded text-gray-200",
			}, "Result: ", currentConfirmResult)),
		),

		// Status info
		vdom.H("div", map[string]any{
			"className": "p-6 bg-gray-800 rounded-lg border border-gray-700",
		},
			vdom.H("h2", map[string]any{
				"className": "text-2xl font-semibold mb-4 text-white",
			}, "Modal Status"),
			vdom.H("div", map[string]any{
				"className": "text-gray-300",
			},
				vdom.H("div", nil, "Alert Modal Open: ", vdom.IfElse(alertOpen, "Yes", "No")),
				vdom.H("div", nil, "Confirm Modal Open: ", vdom.IfElse(confirmOpen, "Yes", "No")),
			),
		),
	)
})
