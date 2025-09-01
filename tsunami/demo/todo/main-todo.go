package main

import (
	"context"
	_ "embed"
	"strconv"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

//go:embed tw.css
var styleCSS []byte

// Initialize client with embedded Tailwind styles and ctrl-c handling
var AppClient = app.MakeClient(app.AppOpts{
	CloseOnCtrlC: true,
	GlobalStyles: styleCSS,
	Title:        "Todo App (Tsunami Demo)",
})

// Basic domain types with json tags for props
type Todo struct {
	Id        int    `json:"id"`
	Text      string `json:"text"`
	Completed bool   `json:"completed"`
}

// Prop types demonstrate parent->child data flow
type TodoListProps struct {
	Todos    []Todo    `json:"todos"`
	OnToggle func(int) `json:"onToggle"`
	OnDelete func(int) `json:"onDelete"`
}

type TodoItemProps struct {
	Todo     Todo   `json:"todo"`
	OnToggle func() `json:"onToggle"`
	OnDelete func() `json:"onDelete"`
}

type InputFieldProps struct {
	Value    string       `json:"value"`
	OnChange func(string) `json:"onChange"`
	OnEnter  func()       `json:"onEnter"`
}

// Reusable input component showing keyboard event handling
var InputField = app.DefineComponent(AppClient, "InputField",
	func(ctx context.Context, props InputFieldProps) any {
		// Example of special key handling with VDomFunc
		keyDown := &vdom.VDomFunc{
			Type:            vdom.ObjectType_Func,
			Fn:              func(event vdom.VDomEvent) { props.OnEnter() },
			StopPropagation: true,
			PreventDefault:  true,
			Keys:            []string{"Enter", "Cmd:Enter"},
		}

		return vdom.H("input", map[string]any{
			"className":   "flex-1 p-2 border border-border rounded",
			"type":        "text",
			"placeholder": "What needs to be done?",
			"value":       props.Value,
			"onChange": func(e vdom.VDomEvent) {
				props.OnChange(e.TargetValue)
			},
			"onKeyDown": keyDown,
		})
	},
)

// Item component showing conditional classes and event handling
var TodoItem = app.DefineComponent(AppClient, "TodoItem",
	func(ctx context.Context, props TodoItemProps) any {
		return vdom.H("div", map[string]any{
			"className": vdom.Classes("flex items-center gap-2.5 p-2 border border-border rounded", vdom.If(props.Todo.Completed, "opacity-70")),
		},
			vdom.H("input", map[string]any{
				"className": "w-4 h-4",
				"type":      "checkbox",
				"checked":   props.Todo.Completed,
				"onChange":  props.OnToggle,
			}),
			vdom.H("span", map[string]any{
				"className": vdom.Classes("flex-1", vdom.If(props.Todo.Completed, "line-through")),
			}, props.Todo.Text),
			vdom.H("button", map[string]any{
				"className": "text-red-500 cursor-pointer px-2 py-1 rounded",
				"onClick":   props.OnDelete,
			}, "×"),
		)
	},
)

// List component demonstrating mapping over data, using WithKey to set key on a component
var TodoList = app.DefineComponent(AppClient, "TodoList",
	func(ctx context.Context, props TodoListProps) any {
		return vdom.H("div", map[string]any{
			"className": "flex flex-col gap-2",
		}, vdom.ForEach(props.Todos, func(todo Todo) any {
			return TodoItem(TodoItemProps{
				Todo:     todo,
				OnToggle: func() { props.OnToggle(todo.Id) },
				OnDelete: func() { props.OnDelete(todo.Id) },
			}).WithKey(strconv.Itoa(todo.Id))
		}))
	},
)

// Root component showing state management and composition
var App = app.DefineComponent(AppClient, "App",
	func(ctx context.Context, _ any) any {
		// Multiple state hooks example
		todos, setTodos := vdom.UseState(ctx, []Todo{
			{Id: 1, Text: "Learn VDOM", Completed: false},
			{Id: 2, Text: "Build a todo app", Completed: false},
		})
		nextId, setNextId := vdom.UseState(ctx, 3)
		inputText, setInputText := vdom.UseState(ctx, "")

		// Event handlers modifying multiple pieces of state
		addTodo := func() {
			if inputText == "" {
				return
			}
			setTodos(append(todos, Todo{
				Id:        nextId,
				Text:      inputText,
				Completed: false,
			}))
			setNextId(nextId + 1)
			setInputText("")
		}

		// Immutable state update pattern
		toggleTodo := func(id int) {
			newTodos := make([]Todo, len(todos))
			copy(newTodos, todos)
			for i := range newTodos {
				if newTodos[i].Id == id {
					newTodos[i].Completed = !newTodos[i].Completed
					break
				}
			}
			setTodos(newTodos)
		}

		// Filter pattern for deletion
		deleteTodo := func(id int) {
			newTodos := vdom.Filter(todos, func(todo Todo) bool {
				return todo.Id != id
			})
			setTodos(newTodos)
		}

		return vdom.H("div", map[string]any{
			"className": "max-w-[500px] m-5 font-sans",
		},
			vdom.H("div", map[string]any{
				"className": "mb-5",
			}, vdom.H("h1", map[string]any{
				"className": "text-2xl font-bold",
			}, "Todo List")),

			vdom.H("div", map[string]any{
				"className": "flex gap-2.5 mb-5",
			},
				InputField(InputFieldProps{
					Value:    inputText,
					OnChange: setInputText,
					OnEnter:  addTodo,
				}),
				vdom.H("button", map[string]any{
					"className": "px-4 py-2 border border-border rounded cursor-pointer",
					"onClick":   addTodo,
				}, "Add Todo"),
			),

			TodoList(TodoListProps{
				Todos:    todos,
				OnToggle: toggleTodo,
				OnDelete: deleteTodo,
			}),
		)
	},
)

func main() {
	AppClient.RunMain()
}
