# Dropdown Component

A custom-styled dropdown component for the Tsunami framework that provides significant value over native HTML select elements. This component features a shadcn-inspired design with custom styling, keyboard navigation, and smooth animations.

## Features

- ✅ **Custom styling** - No native browser controls, fully styled dropdown
- ✅ **Pure JSON-serializable props** - No functions or render functions in props
- ✅ **Keyboard navigation** - Arrow keys, Enter, and Escape support
- ✅ **Click-outside to close** - Intuitive UX
- ✅ **Disabled options** - Individual options can be disabled
- ✅ **Placeholder text** - Clear indication when no selection is made
- ✅ **Default selected values** - Pre-select options
- ✅ **Custom styling** - Via className and style props
- ✅ **Accessible design** - Proper ARIA attributes
- ✅ **Dark theme** - Consistent with Tsunami design system
- ✅ **Smooth animations** - Dropdown open/close and hover states
- ✅ **Highlighted selection** - Visual feedback for current and selected items

## Why Not Native Select?

This component provides significant advantages over using native `<select>` elements:

1. **Consistent cross-browser styling** - Native selects look different on every platform
2. **Custom animations** - Smooth open/close transitions
3. **Better visual design** - Matches the dark theme and overall design system
4. **Enhanced keyboard navigation** - Skip disabled items automatically
5. **Flexible styling** - Complete control over appearance
6. **Better accessibility** - Proper ARIA labels and roles

## Usage

### Basic Dropdown

```go
vdom.H("wave:dropdown", map[string]any{
    "options": []DropdownOption{
        {Label: "Option 1", Value: "option1"},
        {Label: "Option 2", Value: "option2"},
        {Label: "Option 3", Value: "option3"},
    },
    "value": "option1",
    "onChange": func(e vdom.VDomEvent) {
        fmt.Println("Selected:", e.TargetValue)
    },
})
```

### With Placeholder

```go
vdom.H("wave:dropdown", map[string]any{
    "options": options,
    "placeholder": "Choose an option...",
    "onChange": handleChange,
})
```

### With Disabled Options

```go
options := []DropdownOption{
    {Label: "Available", Value: "available"},
    {Label: "Unavailable", Value: "unavailable", Disabled: true},
}

vdom.H("wave:dropdown", map[string]any{
    "options": options,
    "onChange": handleChange,
})
```

### Disabled Dropdown

```go
vdom.H("wave:dropdown", map[string]any{
    "options": options,
    "value": "locked-value",
    "disabled": true,
})
```

### Custom Styling

```go
vdom.H("wave:dropdown", map[string]any{
    "options": options,
    "className": "text-lg font-bold",
    "style": map[string]any{
        "borderWidth": "2px",
        "borderColor": "#10b981",
    },
    "onChange": handleChange,
})
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `[]DropdownOption` | `[]` | Array of options to display |
| `value` | `string` | `""` | Currently selected value |
| `placeholder` | `string` | `"Select an option..."` | Placeholder text when no value selected |
| `disabled` | `boolean` | `false` | Whether the dropdown is disabled |
| `className` | `string` | `""` | Additional CSS classes |
| `style` | `React.CSSProperties` | `{}` | Inline styles |
| `onChange` | `func(e vdom.VDomEvent)` | - | Handler called when selection changes |

## DropdownOption Type

```go
type DropdownOption struct {
    Label    string `json:"label"`
    Value    string `json:"value"`
    Disabled bool   `json:"disabled,omitempty"`
}
```

## Keyboard Navigation

- **Arrow Down** - Move to next enabled option
- **Arrow Up** - Move to previous enabled option
- **Enter** - Select the highlighted option
- **Escape** - Close the dropdown without selecting

## Example Component

See the complete working example in `/tsunami/demo/dropdowntest/app.go`

## Design Principles

The dropdown component follows these Tsunami best practices:

1. **JSON-Serializable Props**: All props can be serialized to JSON for backend-to-frontend communication
2. **No Functions in Props**: Instead of render functions, uses simple data structures (DropdownOption)
3. **Custom Styling**: Provides real value by implementing a custom-styled dropdown (not just wrapping native elements)
4. **Consistent Theming**: Uses dark gray colors matching other Tsunami elements
5. **Accessibility**: Full keyboard navigation and ARIA support
6. **Type Safety**: Fully typed with TypeScript interfaces

## Integration

The dropdown is registered in the VDOM system as `wave:dropdown` and can be used like any other Tsunami element:

```typescript
// In vdom.tsx
const WaveTagMap: Record<string, VDomReactTagType> = {
    "wave:markdown": WaveMarkdown,
    "wave:dropdown": WaveDropdown,
};
```

## Styling Details

The dropdown uses the following color scheme:
- **Trigger**: `bg-gray-800` with `border-gray-700`
- **Hover**: `bg-gray-750` (slightly lighter)
- **Menu**: `bg-gray-800` with `border-gray-700` 
- **Option hover**: `bg-gray-700`
- **Selected option**: `bg-gray-750` with bold font
- **Placeholder**: `text-gray-400`
- **Focus ring**: Blue (`ring-blue-500`)
