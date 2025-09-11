package main

import (
	_ "embed"
	"strconv"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

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
var InputField = app.DefineComponent("InputField", func(props InputFieldProps) any {
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
var TodoItem = app.DefineComponent("TodoItem", func(props TodoItemProps) any {
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
var TodoList = app.DefineComponent("TodoList", func(props TodoListProps) any {
	return vdom.H("div", map[string]any{
		"className": "flex flex-col gap-2",
	}, vdom.ForEach(props.Todos, func(todo Todo, _ int) any {
		return TodoItem(TodoItemProps{
			Todo:     todo,
			OnToggle: func() { props.OnToggle(todo.Id) },
			OnDelete: func() { props.OnDelete(todo.Id) },
		}).WithKey(strconv.Itoa(todo.Id))
	}))
},
)

// Root component showing state management and composition
var App = app.DefineComponent("App", func(_ any) any {
	app.UseSetAppTitle("Todo App (Tsunami Demo)")

	// Multiple local atoms example
	todosAtom := app.UseLocal([]Todo{
		{Id: 1, Text: "Learn VDOM", Completed: false},
		{Id: 2, Text: "Build a todo app", Completed: false},
	})
	nextIdAtom := app.UseLocal(3)
	inputTextAtom := app.UseLocal("")

	// Event handlers modifying multiple pieces of state
	addTodo := func() {
		if inputTextAtom.Get() == "" {
			return
		}
		todosAtom.SetFn(func(todos []Todo) []Todo {
			return append(todos, Todo{
				Id:        nextIdAtom.Get(),
				Text:      inputTextAtom.Get(),
				Completed: false,
			})
		})
		nextIdAtom.Set(nextIdAtom.Get() + 1)
		inputTextAtom.Set("")
	}

	// Immutable state update pattern
	toggleTodo := func(id int) {
		todosAtom.SetFn(func(todos []Todo) []Todo {
			for i := range todos {
				if todos[i].Id == id {
					todos[i].Completed = !todos[i].Completed
					break
				}
			}
			return todos
		})
	}

	deleteTodo := func(id int) {
		todosAtom.SetFn(func(todos []Todo) []Todo {
			newTodos := make([]Todo, 0, len(todos)-1)
			for _, todo := range todos {
				if todo.Id != id {
					newTodos = append(newTodos, todo)
				}
			}
			return newTodos
		})
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
				Value:    inputTextAtom.Get(),
				OnChange: inputTextAtom.Set,
				OnEnter:  addTodo,
			}),
			vdom.H("button", map[string]any{
				"className": "px-4 py-2 border border-border rounded cursor-pointer",
				"onClick":   addTodo,
			}, "Add Todo"),
		),

		TodoList(TodoListProps{
			Todos:    todosAtom.Get(),
			OnToggle: toggleTodo,
			OnDelete: deleteTodo,
		}),
	)
},
)
