package main

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

func init() {
	app.SetAppOpts(app.AppOpts{
		Title: "Pomodoro Timer (Tsunami Demo)",
	})
}

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
		return vdom.E("div",
			vdom.Class("bg-slate-700 p-8 rounded-lg mb-8 text-center"),
			vdom.E("div",
				vdom.Class("text-xl text-blue-400 mb-2"),
				props.Mode,
			),
			vdom.E("div",
				vdom.Class("text-6xl font-bold font-mono text-slate-100"),
				fmt.Sprintf("%02d:%02d", props.Minutes, props.Seconds),
			),
		)
	},
)

var ControlButtons = app.DefineComponent("ControlButtons",
	func(ctx context.Context, props ControlButtonsProps) any {
		return vdom.E("div",
			vdom.Class("flex flex-col gap-4"),
			vdom.IfElse(props.IsRunning,
				vdom.E("button",
					vdom.Class("px-6 py-3 text-lg border-none rounded bg-blue-500 text-white cursor-pointer hover:bg-blue-600 transition-colors duration-200"),
					vdom.P("onClick", props.OnPause),
					"Pause",
				),
				vdom.E("button",
					vdom.Class("px-6 py-3 text-lg border-none rounded bg-blue-500 text-white cursor-pointer hover:bg-blue-600 transition-colors duration-200"),
					vdom.P("onClick", props.OnStart),
					"Start",
				),
			),
			vdom.E("button",
				vdom.Class("px-6 py-3 text-lg border-none rounded bg-blue-500 text-white cursor-pointer hover:bg-blue-600 transition-colors duration-200"),
				vdom.P("onClick", props.OnReset),
				"Reset",
			),
			vdom.E("div",
				vdom.Class("flex gap-4 mt-4"),
				vdom.E("button",
					vdom.Class("flex-1 px-3 py-3 text-base border-none rounded bg-green-500 text-white cursor-pointer hover:bg-green-600 transition-colors duration-200"),
					vdom.P("onClick", func() { props.OnMode(WorkMode.Duration) }),
					"Work Mode",
				),
				vdom.E("button",
					vdom.Class("flex-1 px-3 py-3 text-base border-none rounded bg-green-500 text-white cursor-pointer hover:bg-green-600 transition-colors duration-200"),
					vdom.P("onClick", func() { props.OnMode(BreakMode.Duration) }),
					"Break Mode",
				),
			),
		)
	},
)

var App = app.DefineComponent("App",
	func(ctx context.Context, _ any) any {
		isRunning, setIsRunning, _ := vdom.UseState(ctx, false)
		minutes, setMinutes, _ := vdom.UseState(ctx, WorkMode.Duration)
		seconds, setSeconds, _ := vdom.UseState(ctx, 0)
		mode, setMode, _ := vdom.UseState(ctx, WorkMode.Name)
		_, setIsComplete, _ := vdom.UseState(ctx, false)
		timerRef := vdom.UseRef(ctx, &TimerState{
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
		vdom.UseEffect(ctx, func() func() {
			return func() {
				stopTimer()
			}
		}, []any{})

		return vdom.E("div",
			vdom.Class("max-w-sm mx-auto my-8 p-8 bg-slate-800 rounded-xl text-slate-100 font-sans"),
			vdom.E("h1",
				vdom.Class("text-center text-slate-100 mb-8 text-3xl"),
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
