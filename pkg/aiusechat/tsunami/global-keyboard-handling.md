# Global Keyboard Handling

The Tsunami framework provides two approaches for handling keyboard events:

1. Standard DOM event handling on elements:

```go
vdom.H("div", map[string]any{
    "onKeyDown": func(e vdom.VDomEvent) {
        // Handle key event
    },
})
```

2. Global keyboard event handling:

```go
// Global keyboard events are automatically enabled when you set a global event handler
func init() {
    app.SetGlobalEventHandler(func(event vdom.VDomEvent) {
    if event.EventType != "onKeyDown" || event.KeyData == nil {
        return
    }

    switch event.KeyData.Key {
    case "ArrowUp":
        // Handle up arrow
    case "ArrowDown":
        // Handle down arrow
    }
})
```

The global handler approach is particularly useful when:

- You need to handle keyboard events regardless of focus state
- Building terminal-like applications that need consistent keyboard control
- Implementing application-wide keyboard shortcuts
- Managing navigation in full-screen applications

Key differences:

- Standard DOM events require the element to have focus
- Global events work regardless of focus state
- Global events can be used alongside regular DOM event handlers
- Global handler receives all keyboard events for the application

The event handler receives a VDomEvent with KeyData for keyboard events:

```go
type VDomEvent struct {
    EventType       string             // e.g., "onKeyDown"
    KeyData         *WaveKeyboardEvent `json:"keydata,omitempty"`
    // ... other fields
}

type WaveKeyboardEvent struct {
    Type     string // "keydown", "keyup", "keypress"
    Key      string // The key value (e.g., "ArrowUp")
    Code     string // Physical key code
    Shift    bool   // Modifier states
    Control  bool
    Alt      bool
    Meta     bool
    Cmd      bool   // Meta on Mac, Alt on Windows/Linux
    Option   bool   // Alt on Mac, Meta on Windows/Linux
}
```

When using global keyboard events:

Global keyboard events are automatically enabled when you set a global event handler. Set up the handler in a place where you have access to necessary state updates.