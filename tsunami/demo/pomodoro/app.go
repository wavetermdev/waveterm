package main

import (
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

type Mode struct {
	Name     string `json:"name"`
	Duration int    `json:"duration"` // in minutes
}

var (
	WorkMode  = Mode{Name: "Work", Duration: 25}
	BreakMode = Mode{Name: "Break", Duration: 5}
)

type TimerDisplayProps struct {
	Minutes int    `json:"minutes"`
	Seconds int    `json:"seconds"`
	Mode    string `json:"mode"`
}

type ControlButtonsProps struct {
	IsRunning bool      `json:"isRunning"`
	OnStart   func()    `json:"onStart"`
	OnPause   func()    `json:"onPause"`
	OnReset   func()    `json:"onReset"`
	OnMode    func(int) `json:"onMode"`
}


var TimerDisplay = app.DefineComponent("TimerDisplay",
	func(props TimerDisplayProps) any {
		return vdom.H("div",
			map[string]any{"className": "bg-slate-700 p-8 rounded-lg mb-8 text-center"},
			vdom.H("div",
				map[string]any{"className": "text-xl text-blue-400 mb-2"},
				props.Mode,
			),
			vdom.H("div",
				map[string]any{"className": "text-6xl font-bold font-mono text-slate-100"},
				fmt.Sprintf("%02d:%02d", props.Minutes, props.Seconds),
			),
		)
	},
)

var ControlButtons = app.DefineComponent("ControlButtons",
	func(props ControlButtonsProps) any {
		return vdom.H("div",
			map[string]any{"className": "flex flex-col gap-4"},
			vdom.IfElse(props.IsRunning,
				vdom.H("button",
					map[string]any{
						"className": "px-6 py-3 text-lg border-none rounded bg-blue-500 text-white cursor-pointer hover:bg-blue-600 transition-colors duration-200",
						"onClick":   props.OnPause,
					},
					"Pause",
				),
				vdom.H("button",
					map[string]any{
						"className": "px-6 py-3 text-lg border-none rounded bg-blue-500 text-white cursor-pointer hover:bg-blue-600 transition-colors duration-200",
						"onClick":   props.OnStart,
					},
					"Start",
				),
			),
			vdom.H("button",
				map[string]any{
					"className": "px-6 py-3 text-lg border-none rounded bg-blue-500 text-white cursor-pointer hover:bg-blue-600 transition-colors duration-200",
					"onClick":   props.OnReset,
				},
				"Reset",
			),
			vdom.H("div",
				map[string]any{"className": "flex gap-4 mt-4"},
				vdom.H("button",
					map[string]any{
						"className": "flex-1 px-3 py-3 text-base border-none rounded bg-green-500 text-white cursor-pointer hover:bg-green-600 transition-colors duration-200",
						"onClick":   func() { props.OnMode(WorkMode.Duration) },
					},
					"Work Mode",
				),
				vdom.H("button",
					map[string]any{
						"className": "flex-1 px-3 py-3 text-base border-none rounded bg-green-500 text-white cursor-pointer hover:bg-green-600 transition-colors duration-200",
						"onClick":   func() { props.OnMode(BreakMode.Duration) },
					},
					"Break Mode",
				),
			),
		)
	},
)

var App = app.DefineComponent("App",
	func(_ struct{}) any {
		app.UseSetAppTitle("Pomodoro Timer (Tsunami Demo)")

		isRunning := app.UseLocal(false)
		minutes := app.UseLocal(WorkMode.Duration)
		seconds := app.UseLocal(0)
		mode := app.UseLocal(WorkMode.Name)
		isComplete := app.UseLocal(false)
		startTime := app.UseRef(time.Time{})
		totalDuration := app.UseRef(time.Duration(0))

		// Timer that updates every second using the new pattern
		app.UseTicker(time.Second, func() {
			if !isRunning.Get() {
				return
			}

			elapsed := time.Since(startTime.Current)
			remaining := totalDuration.Current - elapsed

			if remaining <= 0 {
				// Timer completed
				isRunning.Set(false)
				minutes.Set(0)
				seconds.Set(0)
				isComplete.Set(true)
				return
			}

			m := int(remaining.Minutes())
			s := int(remaining.Seconds()) % 60

			// Only send update if values actually changed
			if m != minutes.Get() || s != seconds.Get() {
				minutes.Set(m)
				seconds.Set(s)
			}
		}, []any{isRunning.Get()})

		startTimer := func() {
			if isRunning.Get() {
				return // Timer already running
			}

			isComplete.Set(false)
			startTime.Current = time.Now()
			totalDuration.Current = time.Duration(minutes.Get()) * time.Minute
			isRunning.Set(true)
		}

		pauseTimer := func() {
			isRunning.Set(false)
		}

		resetTimer := func() {
			isRunning.Set(false)
			isComplete.Set(false)
			if mode.Get() == WorkMode.Name {
				minutes.Set(WorkMode.Duration)
			} else {
				minutes.Set(BreakMode.Duration)
			}
			seconds.Set(0)
		}

		changeMode := func(duration int) {
			isRunning.Set(false)
			isComplete.Set(false)
			minutes.Set(duration)
			seconds.Set(0)
			if duration == WorkMode.Duration {
				mode.Set(WorkMode.Name)
			} else {
				mode.Set(BreakMode.Name)
			}
		}

		return vdom.H("div",
			map[string]any{"className": "max-w-sm mx-auto my-8 p-8 bg-slate-800 rounded-xl text-slate-100 font-sans"},
			vdom.H("h1",
				map[string]any{"className": "text-center text-slate-100 mb-8 text-3xl"},
				"Pomodoro Timer",
			),
			TimerDisplay(TimerDisplayProps{
				Minutes: minutes.Get(),
				Seconds: seconds.Get(),
				Mode:    mode.Get(),
			}),
			ControlButtons(ControlButtonsProps{
				IsRunning: isRunning.Get(),
				OnStart:   startTimer,
				OnPause:   pauseTimer,
				OnReset:   resetTimer,
				OnMode:    changeMode,
			}),
		)
	},
)
