# Tsunami Framework Guide

The Tsunami framework brings React-style UI development to Go, letting you build rich graphical applications that run inside Wave Terminal. If you know React, you already understand Tsunami's core concepts - it uses the same patterns for components, props, hooks, state management, and styling, but implemented entirely in Go.

## React Patterns in Go

Tsunami mirrors React's developer experience:

- **Components**: Define reusable UI pieces with typed props structs
- **JSX-like syntax**: Use vdom.H to build element trees (like React.createElement)
- **Hooks**: app.UseEffect, app.UseRef work exactly like React hooks
- **Local state**: Use app.UseLocal as a replacement for React.useState
- **Global state**: Use app.ConfigAtom, app.DataAtom, app.SharedAtom for cross-component state
- **Props and state**: Familiar patterns for data flow and updates
- **Conditional rendering**: vdom.If and vdom.IfElse for dynamic UIs
- **Event handling**: onClick, onChange, onKeyDown with React-like event objects
- **Styling**: Built-in Tailwind v4 CSS classes, plus inline styles via `style` prop

The key difference: everything is pure Go code. No JavaScript, no build tools, no transpilation. You get React's mental model with Go's type safety, performance, and ecosystem.

## Built for AI Development

Tsunami is designed with AI code generation in mind. The framework maps directly to React concepts that AI models understand well:

```go
// This feels like React JSX, but it's pure Go
return vdom.H("div", map[string]any{
    "className": "flex items-center gap-4 p-4",
},
    vdom.H("input", map[string]any{
        "type": "checkbox",
        "checked": todo.Completed,
        "onChange": handleToggle,
    }),
    vdom.H("span", map[string]any{
        "className": vdom.Classes("flex-1", vdom.If(todo.Completed, "line-through")),
    }, todo.Text),
)
```

AI models can leverage their React knowledge to generate Tsunami applications, while developers get the benefits of Go's concurrency, error handling, and type system.

## How It Works

Tsunami applications run as Go programs that generate virtual DOM structures. Wave Terminal renders these as HTML/CSS in its interface, handling the React-like reconciliation and updates. You write Go code using familiar React patterns, and Wave Terminal handles the browser complexity.

## Creating a Tsunami Application

A Tsunami application is simply a Go package with an `App` component. Here's a minimal "Hello World" example:

```go
package main

import (
	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// The App component is the required entry point for every Tsunami application
var App = app.DefineComponent("App", func(_ struct{}) any {
	app.UseSetAppTitle("Hello World")

	return vdom.H("div", map[string]any{
		"className": "flex items-center justify-center h-screen text-xl font-bold",
	}, "Hello, Tsunami!")
})
```

Key Points:

- Must use `package main`.
- The `App` component is required. It serves as the entry point to your application.
- Do NOT add a `main()` function, that is provided by the framework when building.
- Uses Tailwind v4 for styling - you can use any Tailwind classes in your components.
- Use React-style camel case props (`className`, `onClick`)

## Building Elements with vdom.H

The vdom.H function creates virtual DOM elements following a React-like pattern (React.createElement). It takes a tag name, a props map, and any number of children:

```go
// Basic element with no props
vdom.H("div", nil, "Hello world")

// Element with props
vdom.H("div", map[string]any{
    "className": "max-w-4xl mx-auto p-4",
    "id": "main",
    "onClick": func() {
        fmt.Println("clicked!")
    },
},
    "child content",
)

// Element with style (for custom CSS properties not available in Tailwind)
vdom.H("div", map[string]any{
    "style": map[string]any{
        "marginTop": 10,      // Numbers automatically convert to px (like React)
        "zIndex": 1000,       // use React style names
        "transform": "rotate(45deg)",
    },
})

// Working with Tailwind classes
vdom.H("div", map[string]any{
    "className": vdom.Classes(
        "p-4 bg-white rounded-lg",                    // Static Tailwind classes
        vdom.If(isActive, "bg-blue-500 text-white"),     // Conditional class: condition first, then class
        vdom.If(isDisabled, "opacity-50 cursor-not-allowed"), // Another conditional
    ),
})

// Nesting elements
vdom.H("div", map[string]any{
    "className": "max-w-4xl mx-auto",
},
    vdom.H("h1", map[string]any{
        "className": "text-2xl font-bold mb-4",
    }, "Hello"),
    vdom.H("p", map[string]any{
        "className": "text-gray-600 leading-relaxed",
    }, "Some content"),
)

// Handling events
vdom.H("button", map[string]any{
    "className": "px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600",
    "onClick": func() {
        handleClick()
    },
    "onKeyDown": &vdom.VDomFunc{
        Fn: handleKey,
        Keys: []string{"Enter", "Space"},
        PreventDefault: true,
    },
})

// List rendering
vdom.H("ul", map[string]any{
    "className": "space-y-2",
},
    vdom.ForEach(items, func(item string, idx int) any {
        return vdom.H("li", map[string]any{
            "key": idx,
            "className": "py-2 px-4 bg-gray-100 rounded",
        }, item)
    }),
)

// Conditional rendering
vdom.H("div", nil,
    vdom.If(isVisible, vdom.H("span", map[string]any{
        "className": "text-green-500 font-semibold",
    }, "Visible content")),
)
```

Arguments to H:

1. `tag` (string): The HTML tag name
2. `props` (map[string]any or nil): Props map including:
   - className: String of space-separated classes (like React)
   - style: map[string]any of CSS properties (like React)
   - Event handlers (onClick, onChange, etc)
   - Any other valid HTML attributes
3. `children` (...any): Any number of child elements:
   - Other H() elements
   - Strings (become text nodes)
   - Numbers (converted to string)
   - Arrays of the above
   - nil values are ignored
   - Anything with String() method becomes text

Best practices:

- Use vdom.Classes with vdom.If for conditional classes (similar to React's conditional className patterns)
- Use camelCase for style properties (exactly like React)
- Numbers in style are automatically converted to pixel values (like React)
- Always create new slices when updating arrays in state (like React's immutability principle)
- Use vdom.ForEach for list rendering (always passes index, like React's map with index)
- Include key prop when rendering lists (essential for React-like reconciliation)

## Conditional Rendering and Lists

The system provides helper functions for conditional and list rendering:

```go
// Conditional rendering with vdom.If()
vdom.H("div", nil,
    vdom.If(isVisible,
        vdom.H("span", nil, "Visible content"),
    ),
)

// Branching with vdom.IfElse()
vdom.H("div", nil,
    vdom.IfElse(isActive,
        vdom.H("span", nil, "Active"),
        vdom.H("span", nil, "Inactive"),
    ),
)

// List rendering (adding "key" prop to li element)
items := []string{"A", "B", "C"}
vdom.H("ul", nil,
    vdom.ForEach(items, func(item string, idx int) any {
        return vdom.H("li", map[string]any{
            "key": idx,
            "className": "py-2 px-3 border-b border-gray-100",
        }, item)
    }),
)
```

Helper functions:

- `vdom.If(cond bool, part any) any` - Returns part if condition is true, nil otherwise
- `vdom.IfElse(cond bool, part any, elsePart any) any` - Returns part if condition is true, elsePart otherwise
- `vdom.Ternary[T any](cond bool, trueRtn T, falseRtn T) T` - Type-safe ternary operation, returns trueRtn if condition is true, falseRtn otherwise
- `vdom.ForEach[T any](items []T, fn func(T, int) any) []any` - Maps over items with index, function receives item and index
- `vdom.Classes(classes ...any) string` - Combines multiple class values into a single space-separated string, similar to JavaScript clsx library (accepts string, []string, and map[string]bool params)
- `app.DeepCopy[T any](value T) T` - Creates a deep copy of slices, maps, and other complex types for safe state updates

- The vdom.If and vdom.IfElse functions can be used for both conditional rendering of elements, conditional classes, and conditional props.
- For vdom.If and vdom.IfElse, always follow the pattern of condition first (bool), then value(s).
- Use vdom.IfElse for conditions that return different types, use Ternary when the return values are the same type.

## Using Hooks in Tsunami

Functions starting with `app.Use*` are hooks in Tsunami, following the exact same rules as React hooks.

**Key Rules:**

- ✅ Only call hooks inside app.DefineComponent functions
- ✅ Always call hooks at the **top level** of your component function
- ✅ Call hooks before any early returns or conditional logic
- 🔴 Never call hooks inside loops, conditions, or after conditional returns

```go
var MyComponent = app.DefineComponent("MyComponent", func(props MyProps) any {
	// ✅ Good: hooks at top level
	count := app.UseLocal(0)
	app.UseEffect(func() { /* effect */ }, nil)

	// Now safe to have conditional logic
	if someCondition {
		return vdom.H("div", nil, "Early return")
	}

	return vdom.H("div", nil, "Content")
})
```

**Common Hooks (React-like):**

- `app.UseLocal[T any](initialVal T) Atom[T]` - Component state management (replacement for React.useState)
- `app.UseEffect(fn func() func(), deps []any)` - Side effects after render (React.useEffect)
- `app.UseRef[T any](val T) *VDomSimpleRef[T]` - Mutable refs for arbitrary values (React.useRef)
- `app.UseVDomRef() *VDomRef` - DOM element references (React.useRef for DOM elements)
- `app.UseSetAppTitle(title string)` - Sets the application title (used in every app, only works in top-level "App" component)

**Specialty Hooks (less common):**

- `app.UseId() string` - Component's unique identifier
- `app.UseRenderTs() int64` - Current render timestamp
- `app.UseResync() bool` - Whether current render is a resync operation

Most applications won't need these specialty hooks, but they're available for advanced use cases.

This ensures hooks are called in the same order every render, which is essential for Tsunami's state management.

## State Management with Atoms

Tsunami uses **atoms** as the unified approach to state management. Whether you're managing local component state or global application state, you work with the same atom interface that prevents common bugs and provides type safety.

### What Are Atoms?

An atom is an object that holds a value and provides methods to read and update it:

```go
// Create an atom (local component state)
count := app.UseLocal(0)

// Read the current value (always up-to-date)
currentValue := count.Get()

// Update the value (only in event handlers, effects, or async code)
count.Set(42)

// Functional update based on current value
count.SetFn(func(current int) int {
    return current + 1
})
```

### The Atom Interface

All atoms implement the same interface:

- **`Get()`** - Returns the current value, registers render dependency
- **`Set(value)`** - Updates the atom with a new value
- **`SetFn(func(current) new)`** - Updates the atom using a function that receives the current value

### Key Benefits

**Prevents Stale Closures**: Unlike React's useState where captured values become stale, `atom.Get()` always returns the current value:

```javascript
// React problem: count is stale in setTimeout
const [count, setCount] = useState(0);
setTimeout(() => console.log(count), 1000); // Always logs 0
```

```go
// Tsunami solution: always current
count := app.UseLocal(0)
time.AfterFunc(time.Second, func() {
    fmt.Println(count.Get()) // Always logs current value
})
```

**Type Safety**: Atoms are strongly typed. If you declare an atom as app.Atom[int], it can only hold integers:

```go
userCount := app.SharedAtom("userCount", 0)
// userCount.Set("hello") // Compile error - can't assign string to int atom
```

**No Stale References**: When atoms are shared across components, everyone gets the same typed object with no typos or type mismatches.

### Important Rules

**Read with Get()**: Always use `atom.Get()` to read values in your render code:

```go
var MyComponent = app.DefineComponent("MyComponent", func(_ struct{}) any {
    count := app.UseLocal(0)

    // ✅ Correct: Read with Get()
    currentCount := count.Get()

    return vdom.H("div", nil, "Count: ", currentCount)
})
```

**Write in handlers only**: Never call `atom.Set()` or `atom.SetFn()` in render code - only in event handlers, effects, or async code:

```go
var MyComponent = app.DefineComponent("MyComponent", func(_ struct{}) any {
    count := app.UseLocal(0)

    // ✅ Correct: Update in event handler
    handleClick := func() {
        count.Set(count.Get() + 1)
    }

    // ❌ Wrong: Never update in render code
    // count.Set(42) // This would cause infinite re-renders

    return vdom.H("button", map[string]any{
        "onClick": handleClick,
    }, "Click me")
})
```

### Local State with app.UseLocal

For component-specific state, use app.UseLocal:

```go
var MyComponent = app.DefineComponent("MyComponent", func(_ struct{}) any {
    // Like React.useState, but with atom interface
    name := app.UseLocal("John")
    items := app.UseLocal([]string{})

    // Read values in render code
    currentName := name.Get()
    currentItems := items.Get()

    // Update in event handlers
    handleAddItem := func(item string) {
        items.SetFn(func(current []string) []string {
            return append(current, item)
        })
    }

    return vdom.H("div", nil, "Name: ", currentName)
})
```

### Global State Management

For state shared across components or accessible to external systems, declare global atoms as package variables:

#### Declaring Global Atoms

```go
// Declare global atoms as package-level variables
var (
    // SharedAtom - Basic shared state between components
    isLoading = app.SharedAtom("isLoading", false)
    userPrefs = app.SharedAtom("userPrefs", UserPreferences{})

    // ConfigAtom - Configuration that external systems can read/write
    theme = app.ConfigAtom("theme", "dark")
    apiKey = app.ConfigAtom("apiKey", "")
    maxRetries = app.ConfigAtom("maxRetries", 3)

    // DataAtom - Application data that external systems can read
    currentUser = app.DataAtom("currentUser", UserStats{})
    lastPollResult = app.DataAtom("lastPoll", APIResult{})
)
```

#### Using Global Atoms

Global atoms work exactly like local atoms - same Get/Set interface:

```go
var MyComponent = app.DefineComponent("MyComponent", func(_ struct{}) any {
    // Reading atom values (registers render dependency)
    loading := isLoading.Get()
    currentTheme := theme.Get()
    user := currentUser.Get()

    // Setting atom values (only in event handlers)
    handleToggle := func() {
        isLoading.Set(true) // Direct value setting
    }

    handleRetry := func() {
        maxRetries.SetFn(func(current int) int {
            return current + 1  // Functional update
        })
    }

    return vdom.H("div", nil, "Loading: ", loading)
})
```

#### Global Atom Types

**SharedAtom** - Basic shared state between components:

- Shared within the application only
- Not accessible to external systems
- Perfect for UI state, user preferences, app-wide flags

**ConfigAtom** - Configuration that external systems can read/write:

- External tools can GET/POST to `/api/config` to read/modify these
- Perfect for user settings, API keys, feature flags
- Triggers re-renders when updated internally or externally

**DataAtom** - Application data that external systems can read:

- External tools can GET `/api/data` to inspect app state
- Ideal for application state, user data, API results
- Read-only from external perspective

#### External API Integration

ConfigAtom and DataAtom automatically create REST endpoints:

- `GET /api/config` - Returns all config atom values
- `POST /api/config` - Updates (merges) config atom values
- `GET /api/data` - Returns all data atom values

This makes Tsunami applications naturally suitable for integration with external tools, monitoring systems, and AI agents that need to inspect or configure the application.

## Style Handling

Tsunami applications use Tailwind v4 CSS by default for styling (className prop) and you should favor styling with Tailwind whenever possible. Also Tsunami Apps are built to run inside of Wave Terminal which is a dark mode application. Please create your styles in tailwind specifically to support DARK mode (so dark backgrounds and light text colors). You may also define inline styles using a map[string]any in the props:

```go
vdom.H("div", map[string]any{
    "style": map[string]any{
        "marginRight": 10,         // Numbers for px values
        "backgroundColor": "#fff", // Colors as strings
        "display": "flex",         // CSS values as strings
        "fontSize": 16,            // More numbers
        "borderRadius": 4,         // Numbers to px
    },
})

// Multiple style properties can be combined with dynamic values
vdom.H("div", map[string]any{
    "style": map[string]any{
        "marginTop": spacing,      // Variables work too
        "color": vdom.IfElse(isActive, "blue", "gray"),
        "display": "flex",
        "opacity": vdom.If(isVisible, 1.0),  // Conditional styles
    },
})
```

Properties use camelCase (must match React) and values can be:

- Numbers (automatically converted to pixel values)
- Colors as strings
- Other CSS values as strings
- Conditional values using If/IfElse

The style map in props mirrors React's style object pattern, making it familiar to React developers while maintaining type safety in Go.

### External Styles and Stylesheets

Quick styles can be added using a vdom.H("style", nil, "...") tag. You may also place CSS files in the `static` directory, and serve them directly with:

```go
vdom.H("link", map[string]any{"rel": "stylesheet", "src": "/static/mystyles.css"})
```

## Component Definition Pattern

Create typed, reusable components using the client:

```go
// Define prop types with json tags
type TodoItemProps struct {
    Todo     Todo    `json:"todo"`
    OnToggle func()  `json:"onToggle"`
    IsActive bool    `json:"isActive"`
}

// Create component with typed props
var TodoItem = app.DefineComponent("TodoItem", func(props TodoItemProps) any {
	return vdom.H("div", map[string]any{
		"className": vdom.Classes(
			"p-3 border-b border-gray-200 cursor-pointer transition-opacity",
			vdom.IfElse(props.IsActive, "opacity-100 bg-blue-50", "opacity-70 hover:bg-gray-50"),
		),
		"onClick": props.OnToggle,
	}, props.Todo.Text)
})

// Usage in parent component:
vdom.H("div", map[string]any{
    "className": "bg-white rounded-lg shadow-sm border",
},
    TodoItem(TodoItemProps{
        Todo: todo,
        OnToggle: handleToggle,
        IsActive: isCurrentItem,
    }),
)

// Usage with key (when in lists)
TodoItem(TodoItemProps{
    Todo: todo,
    OnToggle: handleToggle,
}).WithKey(idx)
```

Components in Tsunami:

- Use Go structs with json tags for props
- Take props as their single argument
- Return elements created with vdom.H
- Can use all hooks (app.UseLocal, app.UseRef, etc)
- Are registered with the default client and given a name
- Are called as functions with their props struct

Special Handling for Component "key" prop:

- Use the `WithKey(key any)` chaining func to set a key on a component
- Keys must be added for components rendered in lists (just like in React)
- Keys should be unique among siblings and stable across renders
- Keys are handled at the framework level and should not be declared in component props
- `WithKey` accepts any type and automatically converts it to a string using fmt.Sprint

This pattern matches React's functional components while maintaining Go's type safety and explicit props definition.

## Handler Functions

For most event handling, passing a function directly in the props map works:

```go
vdom.H("button", map[string]any{
    "onClick": func() {
        fmt.Println("clicked!")
    },
})

// With event data
vdom.H("input", map[string]any{
    "onChange": func(e vdom.VDomEvent) {
        fmt.Println("new value:", e.TargetValue)
    },
})
```

For keyboard events that need special handling, preventDefault, or stopPropagation, use VDomFunc:

```go
// Handle specific keys with onKeyDown
keyHandler := &vdom.VDomFunc{
    Type:            vdom.ObjectType_Func,
    Fn:              func(event vdom.VDomEvent) {
        // handle key press
    },
    StopPropagation: true,    // Stop event bubbling
    PreventDefault: true,     // Prevent default browser behavior
    Keys: []string{
        "Enter",              // Just Enter key
        "Shift:Tab",          // Shift+Tab
        "Control:c",          // Ctrl+C
        "Meta:v",             // Meta+V (Windows)/Command+V (Mac)
        "Alt:x",              // Alt+X
        "Cmd:s",             // Command+S (Mac)/Alt+S (Windows)
        "Option:f",          // Option+F (Mac)/Meta+F (Windows)
    },
}

vdom.H("input", map[string]any{
    "className": "px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500",
    "onKeyDown": keyHandler,
})

// Common pattern for form handling
vdom.H("form", map[string]any{
    "onSubmit": &vdom.VDomFunc{
        Fn:             handleSubmit,
        PreventDefault: true,  // Prevent form submission
    },
})
```

The Keys field on VDomFunc:

- Only works with onKeyDown events
- Format is "[modifier]:key" or just "key"
- Modifiers:
  - Shift, Control, Meta, Alt: work as expected
  - Cmd: maps to Meta on Mac, Alt on Windows/Linux
  - Option: maps to Alt on Mac, Meta on Windows/Linux

Event handlers follow React patterns while providing additional type safety and explicit control over event behavior through VDomFunc.

## State Management with Hooks

```go
var MyComponent = app.DefineComponent("MyComponent", func(props struct{}) any {
	// UseLocal: returns Atom[T] with Get(), Set(), and SetFn() methods
	count := app.UseLocal(0)          // Initial value of 0
	items := app.UseLocal([]string{}) // Initial value of empty slice

	// Reading values in render code
	currentCount := count.Get()
	currentItems := items.Get()

	// Event handlers that update state (called from onClick, onChange, etc.)
	incrementCount := func() {
		count.Set(currentCount + 1) // Direct update when you have the value
	}

	incrementCountFn := func() {
		count.SetFn(func(current int) int {
			return current + 1 // Functional update based on current value
		})
	}

	addItem := func(item string) {
		// When updating slices/maps, create new value
		items.SetFn(func(current []string) []string {
			newItems := app.DeepCopy(current)
			return append(newItems, item)
		})
	}

	// Refs for values that persist between renders but don't trigger updates
	renderCounter := app.UseRef(0)
	renderCounter.Current++ // Doesn't cause re-render

	// DOM refs for accessing elements directly
	inputRef := app.UseVDomRef()

	// Side effects (can call setters here)
	app.UseEffect(func() func() {
		// Example: set counter to 10 on mount
		count.Set(10)

		return func() {
			// cleanup
		}
	}, []any{}) // Empty dependency array means run once on mount

	return vdom.H("div", nil,
		vdom.H("button", map[string]any{
			"onClick": incrementCount, // State setter called in event handler
		}, "Increment: ", currentCount),
		vdom.H("button", map[string]any{
			"onClick": incrementCountFn, // Functional setter in event handler
		}, "Functional Increment: ", currentCount),
		vdom.H("input", map[string]any{
			"ref":         inputRef,
			"type":        "text",
			"placeholder": "Add item",
			"onKeyDown": &vdom.VDomFunc{
				Fn: func(e vdom.VDomEvent) {
					if e.TargetValue != "" {
						addItem(e.TargetValue) // State setter in event handler
					}
				},
				Keys: []string{"Enter"},
			},
		}),
		vdom.H("ul", nil,
			vdom.ForEach(currentItems, func(item string, idx int) any {
				return vdom.H("li", map[string]any{
					"key": idx,
				}, item)
			}),
		),
	)
})
```

## Available Hooks

The system provides three main types of hooks:

1. app.UseLocal - Component state management (Tsunami's equivalent to React.useState):

   - Returns an Atom[T] with Get(), Set(), and SetFn() methods instead of React's [value, setter] tuple
   - Use Get() to read the current value (triggers re-render dependency)
   - Use Set() for direct value updates or SetFn() for functional updates
   - Create new values for slices/maps when updating
   - AI models familiar with React.useState should adapt their patterns to use UseLocal with .Get()/.Set()/.SetFn()

   ```go
   // React.useState equivalent:
   // const [count, setCount] = useState(0);
   count := app.UseLocal(0)

   // Reading the current value (in render code):
   currentValue := count.Get()  // Instead of just using `count`

   // IMPORTANT: Set/SetFn should NEVER be called in render code!
   // Only call them in event handlers, effects, or async code:

   handleClick := func() {
       count.Set(42)  // Instead of setCount(42)
   }

   handleIncrement := func() {
       count.SetFn(func(current int) int {  // Instead of setCount(prev => prev + 1)
           return current + 1
       })
   }
   ```

2. app.UseRef - For values that persist between renders without triggering updates (like React.useRef):

   - Holds mutable values that survive re-renders
   - Changes don't cause re-renders
   - Perfect for:
     - Managing goroutine state
     - Storing timers/channels
     - Tracking subscriptions
     - Holding complex state structures
   - Unlike React, this ref CANNOT be set as the ref prop on an element

   ```go
   timerRef := app.UseRef(&TimerState{
       done: make(chan bool),
   })
   ```

3. app.UseVDomRef - For accessing DOM elements directly:
   - Creates refs for DOM interaction
   - Useful for:
     - Accessing DOM element properties
     - Managing focus
     - Measuring elements
     - Direct DOM manipulation when needed
   - These ref objects SHOULD be set as ref prop on elements.
   ```go
   inputRef := app.UseVDomRef()
   vdom.H("input", map[string]any{
       "ref": inputRef,
       "type": "text",
   })
   ```

Best Practices:

- Use app.UseLocal for all UI state - use .Get() for reading and .Set()/.SetFn() for updating
- Use functional setter when updating state from goroutines or based on current value
- Use app.UseRef for complex state that goroutines need to access
- Always clean up timers, channels, and goroutines in app.UseEffect cleanup functions

## State Management and Async Updates

For global state management, use the atoms system (SharedAtom, Config, or Data as appropriate). This provides global reactive state that components can subscribe to:

```go
type Todo struct {
	Id   int    `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// For async operations, consider using a state struct
type TimerState struct {
	ticker   *time.Ticker
	done     chan bool
	isActive bool
}

// Declare global atoms as package variables
var (
	todosAtom  = app.DataAtom("todos", []Todo{})
	filterAtom = app.ConfigAtom("filter", "")
)

var TodoApp = app.DefineComponent("TodoApp", func(_ struct{}) any {
	// Local state for async timer demo
	seconds := app.UseLocal(0)

	// Use refs to store complex state that goroutines need to access
	stateRef := app.UseRef(&TimerState{
		done: make(chan bool),
	})

	// Example of safe goroutine management
	startAsync := func() {
		if stateRef.Current.isActive {
			return // Prevent multiple goroutines
		}

		stateRef.Current.isActive = true
		go func() {
			defer func() {
				stateRef.Current.isActive = false
			}()

			// Use channels for cleanup
			for {
				select {
				case <-stateRef.Current.done:
					return
				case <-time.After(time.Second):
					// Use functional updates for state that depends on current value
					seconds.SetFn(func(s int) int {
						return s + 1
					})
					// Notify UI of update
					app.SendAsyncInitiation()
				}
			}
		}()
	}

	// Always clean up goroutines
	stopAsync := func() {
		if stateRef.Current.isActive {
			close(stateRef.Current.done)
			stateRef.Current.done = make(chan bool)
		}
	}

	// Use app.UseEffect for cleanup on unmount
	app.UseEffect(func() func() {
		startAsync() // Start the timer when component mounts
		return func() {
			stopAsync()
		}
	}, []any{})

	addTodo := func(text string) {
		currentTodos := todosAtom.Get()
		newTodo := Todo{
			Id:   len(currentTodos) + 1,
			Text: text,
			Done: false,
		}
		todosAtom.Set(append(currentTodos, newTodo))
	}

	// Read atom values in render code
	todos := todosAtom.Get()
	filter := filterAtom.Get()
	currentSeconds := seconds.Get()

	return vdom.H("div", map[string]any{"className": "todo-app"},
		vdom.H("h1", nil, "Todo App"),
		vdom.H("p", nil, "Timer: ", currentSeconds, " seconds"),
		vdom.H("input", map[string]any{
			"placeholder": "Filter todos...",
			"value":       filter,
			"onChange":    func(e vdom.VDomEvent) { filterAtom.Set(e.TargetValue) },
		}),
		vdom.H("button", map[string]any{
			"onClick": func() { addTodo("New todo") },
		}, "Add Todo"),
		vdom.ForEach(todos, func(todo Todo, idx int) any {
			// Only show todos that contain the filter text
			if filter != "" && !strings.Contains(strings.ToLower(todo.Text), strings.ToLower(filter)) {
				return nil
			}
			return vdom.H("div", map[string]any{
				"key":       todo.Id,
				"className": "todo-item",
			},
				vdom.H("span", nil, todo.Text),
			)
		}),
	)
})
```

Key points for state management:

- Global state is fine for simple data structures
- Use functional setter when updating state based on its current value, especially in goroutines
- Store complex state in refs when it needs to be accessed by goroutines
- Use app.UseEffect cleanup function to handle component unmount
- Call app.SendAsyncInitiation after state changes in goroutines (consider round trip performance, so don't call at very high speeds)
- Use atomic operations if globals are modified from multiple goroutines (or locks)

## Global Keyboard Handling

For some applications, getting access to each key press regardless of focus state is essential. To enable global keyboard handling that captures all keyboard events across your application, see the global-keyboard-handling.md document.

## File Handling

The Tsunami framework provides two simple approaches for serving content:

### Static Files

For static assets (images, CSS, fonts, etc.), simply create a `static/` directory in your application directory. All files in this directory are automatically served under the `/static/` URL path:

```
your-app/
├── app.go
└── static/
    ├── logo.png
    ├── styles.css
    └── images/
        └── icon.svg
```

Use these files in your components with `/static/` URLs:

```go
vdom.H("img", map[string]any{
    "src": "/static/logo.png",
    "alt": "Logo",
})

vdom.H("div", map[string]any{
    "style": map[string]any{
        "background": "url(/static/images/icon.svg)",
    },
})
```

### Dynamic URL Handlers

For dynamic content or API endpoints, use app.HandleDynFunc to register standard http.ServeMux handlers. All dynamic routes MUST be registered under the `/dyn/` path:

```go
// Register dynamic handlers (typically in init() or setup function)
app.HandleDynFunc("/dyn/api/data", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
})

app.HandleDynFunc("/dyn/generate-image", func(w http.ResponseWriter, r *http.Request) {
    // Generate dynamic content
    img := generateImage()
    w.Header().Set("Content-Type", "image/png")
    png.Encode(w, img)
})

// Use standard http.ServeMux patterns
app.HandleDynFunc("/dyn/files/{id}", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    // Handle file by ID
})
```

Use dynamic endpoints in your components:

```go
vdom.H("img", map[string]any{
    "src": "/dyn/generate-image?type=chart&data=123",
    "alt": "Dynamic Chart",
})
```

Key points:

- **Static files**: Create `static/` directory, use `/static/` URLs
- **Dynamic content**: Use app.HandleDynFunc with `/dyn/` prefix
- Dynamic handlers use standard Go http.Handler interface
- You can use any http.ServeMux pattern in the route
- Content-Type is automatically detected for static files
- For dynamic handlers, set Content-Type explicitly when needed

## Tsunami App Template

```go
package main

import (
	_ "embed"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Tsunami applications automatically include Tailwind v4 CSS
// No setup required - just use Tailwind classes in your components

// Basic domain types with json tags for props
type Todo struct {
	Id        int    `json:"id"`
	Text      string `json:"text"`
	Completed bool   `json:"completed"`
}

type TodoItemProps struct {
	Todo     Todo   `json:"todo"`
	OnToggle func() `json:"onToggle"`
	OnDelete func() `json:"onDelete"`
}

// Reusable components
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
})

// Root component must be named "App"
var App = app.DefineComponent("App", func(_ struct{}) any {
	// UseLocal returns Atom[T] with Get() and Set() methods
	todos := app.UseLocal([]Todo{
		{Id: 1, Text: "Learn Tsunami", Completed: false},
		{Id: 2, Text: "Build an app", Completed: false},
	})
	nextId := app.UseLocal(3)
	inputText := app.UseLocal("")

	// Event handlers
	addTodo := func() {
		currentInput := inputText.Get()
		if currentInput == "" {
			return
		}
		currentTodos := todos.Get()
		currentNextId := nextId.Get()

		todos.Set(append(currentTodos, Todo{
			Id:        currentNextId,
			Text:      currentInput,
			Completed: false,
		}))
		nextId.Set(currentNextId + 1)
		inputText.Set("")
	}

	toggleTodo := func(id int) {
		currentTodos := todos.Get()
		newTodos := make([]Todo, len(currentTodos))
		copy(newTodos, currentTodos)
		for i := range newTodos {
			if newTodos[i].Id == id {
				newTodos[i].Completed = !newTodos[i].Completed
				break
			}
		}
		todos.Set(newTodos)
	}

	deleteTodo := func(id int) {
		currentTodos := todos.Get()
		newTodos := make([]Todo, 0)
		for _, todo := range currentTodos {
			if todo.Id != id {
				newTodos = append(newTodos, todo)
			}
		}
		todos.Set(newTodos)
	}

	// Read atom values in render code
	todoList := todos.Get()
	currentInput := inputText.Get()

	return vdom.H("div", map[string]any{
		"className": "max-w-[500px] m-5 font-sans",
	},
		vdom.H("h1", map[string]any{
			"className": "text-2xl font-bold mb-5",
		}, "My Tsunami App"),

		vdom.H("div", map[string]any{
			"className": "flex gap-2.5 mb-5",
		},
			vdom.H("input", map[string]any{
				"className":   "flex-1 p-2 border border-border rounded",
				"type":        "text",
				"placeholder": "Add new item...",
				"value":       currentInput,
				"onChange": func(e vdom.VDomEvent) {
					inputText.Set(e.TargetValue)
				},
			}),
			vdom.H("button", map[string]any{
				"className": "px-4 py-2 border border-border rounded cursor-pointer",
				"onClick":   addTodo,
			}, "Add"),
		),

		vdom.H("div", map[string]any{
			"className": "flex flex-col gap-2",
		}, vdom.ForEach(todoList, func(todo Todo, _ int) any {
			return TodoItem(TodoItemProps{
				Todo:     todo,
				OnToggle: func() { toggleTodo(todo.Id) },
				OnDelete: func() { deleteTodo(todo.Id) },
			}).WithKey(todo.Id)
		})),
	)
})
```

Key points:

1. Root component must be named "App"
2. Use app.UseSetAppTitle in the main App component to set the window title
3. Do NOT write a main() function - the framework handles app lifecycle
4. Use init() for setup like registering dynamic handlers with app.HandleDynFunc

## Important Technical Details

- Props must be defined as Go structs with json tags
- Components take their props type directly.
- Always use app.DefineComponent for component registration
- Call app.SendAsyncInitiation after async state updates
- Provide keys when using vdom.ForEach with lists (using WithKey method)
- Use vdom.Classes with vdom.If for combining static and conditional class names
- Consider cleanup functions in app.UseEffect for async operations
- `<script>` tags are NOT supported
- Applications consist of a single file: app.go containing all Go code and component definitions
- Styling is handled through Tailwind v4 CSS classes
- Create Apps that work well in DARK mode (dark backgrounds, and light text)
- Do NOT write a main() function - use init() for setup like dynamic handlers
- This is a pure Go system - do not attempt to write React components or JavaScript code
- All UI rendering, including complex visualizations, should be done through Go using vdom.H

The todo demo demonstrates all these patterns in a complete application.
