package main

import (
	"context"
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

type TimerState struct {
	ticker    *time.Ticker
	done      chan bool
	startTime time.Time
	duration  time.Duration
	isActive  bool // Track if the timer goroutine is running
}

var TimerDisplay = app.DefineComponent("TimerDisplay",
	func(ctx context.Context, props TimerDisplayProps) any {
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
	func(ctx context.Context, props ControlButtonsProps) any {
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
	func(ctx context.Context, _ any) any {
		app.UseSetAppTitle("Pomodoro Timer (Tsunami Demo)")

		isRunning, setIsRunning, _ := app.UseState(false)
		minutes, setMinutes, _ := app.UseState(WorkMode.Duration)
		seconds, setSeconds, _ := app.UseState(0)
		mode, setMode, _ := app.UseState(WorkMode.Name)
		_, setIsComplete, _ := app.UseState(false)
		timerRef := app.UseRef(&TimerState{
			done: make(chan bool),
		})

		stopTimer := func() {
			if timerRef.Current.ticker != nil {
				timerRef.Current.ticker.Stop()
				timerRef.Current.ticker = nil
			}
			if timerRef.Current.isActive {
				close(timerRef.Current.done)
				timerRef.Current.isActive = false
			}
			timerRef.Current.done = make(chan bool)
		}

		startTimer := func() {
			if timerRef.Current.isActive {
				return // Timer already running
			}

			// Stop any existing timer first
			stopTimer()

			setIsComplete(false)
			timerRef.Current.startTime = time.Now()
			timerRef.Current.duration = time.Duration(minutes) * time.Minute
			timerRef.Current.isActive = true
			setIsRunning(true)
			timerRef.Current.ticker = time.NewTicker(1 * time.Second)

			go func() {
				for {
					select {
					case <-timerRef.Current.done:
						return
					case <-timerRef.Current.ticker.C:
						elapsed := time.Since(timerRef.Current.startTime)
						remaining := timerRef.Current.duration - elapsed

						if remaining <= 0 {
							// Timer completed
							setIsRunning(false)
							setMinutes(0)
							setSeconds(0)
							setIsComplete(true)
							stopTimer()
							app.SendAsyncInitiation()
							return
						}

						m := int(remaining.Minutes())
						s := int(remaining.Seconds()) % 60

						// Only send update if values actually changed
						if m != minutes || s != seconds {
							setMinutes(m)
							setSeconds(s)
							app.SendAsyncInitiation()
						}
					}
				}
			}()
		}

		pauseTimer := func() {
			stopTimer()
			setIsRunning(false)
			app.SendAsyncInitiation()
		}

		resetTimer := func() {
			stopTimer()
			setIsRunning(false)
			setIsComplete(false)
			if mode == WorkMode.Name {
				setMinutes(WorkMode.Duration)
			} else {
				setMinutes(BreakMode.Duration)
			}
			setSeconds(0)
			app.SendAsyncInitiation()
		}

		changeMode := func(duration int) {
			stopTimer()
			setIsRunning(false)
			setIsComplete(false)
			setMinutes(duration)
			setSeconds(0)
			if duration == WorkMode.Duration {
				setMode(WorkMode.Name)
			} else {
				setMode(BreakMode.Name)
			}
			app.SendAsyncInitiation()
		}

		// Cleanup on unmount
		app.UseEffect(func() func() {
			return func() {
				stopTimer()
			}
		}, []any{})

		return vdom.H("div",
			map[string]any{"className": "max-w-sm mx-auto my-8 p-8 bg-slate-800 rounded-xl text-slate-100 font-sans"},
			vdom.H("h1",
				map[string]any{"className": "text-center text-slate-100 mb-8 text-3xl"},
				"Pomodoro Timer",
			),
			TimerDisplay(TimerDisplayProps{
				Minutes: minutes,
				Seconds: seconds,
				Mode:    mode,
			}),
			ControlButtons(ControlButtonsProps{
				IsRunning: isRunning,
				OnStart:   startTimer,
				OnPause:   pauseTimer,
				OnReset:   resetTimer,
				OnMode:    changeMode,
			}),
		)
	},
)
