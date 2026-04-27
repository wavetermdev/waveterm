---
name: add-wshcmd
description: Guide for adding new wsh commands to Wave Terminal. Use when implementing new CLI commands, adding command-line functionality, or extending the wsh command interface.
---

# Adding a New wsh Command to Wave Terminal

This guide explains how to add a new command to the `wsh` CLI tool.

## wsh Command System Overview

Wave Terminal's `wsh` command provides CLI access to Wave Terminal features. The system uses:

1. **Cobra Framework** - CLI command structure and parsing
2. **Command Files** - Individual command implementations in `cmd/wsh/cmd/wshcmd-*.go`
3. **RPC Client** - Communication with Wave Terminal backend via `RpcClient`
4. **Activity Tracking** - Telemetry for command usage analytics
5. **Documentation** - User-facing docs in `docs/docs/wsh-reference.mdx`

Commands are registered in their `init()` functions and execute through the Cobra framework.

## Step-by-Step Guide

### Step 1: Create Command File

Create a new file in `cmd/wsh/cmd/` named `wshcmd-[commandname].go`:

```go
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
    "fmt"

    "github.com/spf13/cobra"
    "github.com/wavetermdev/waveterm/pkg/wshrpc"
    "github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var myCommandCmd = &cobra.Command{
    Use:   "mycommand [args]",
    Short: "Brief description of what this command does",
    Long: `Detailed description of the command.
Can include multiple lines and examples of usage.`,
    RunE:                  myCommandRun,
    PreRunE:               preRunSetupRpcClient,  // Include if command needs RPC
    DisableFlagsInUseLine: true,
}

// Flag variables
var (
    myCommandFlagExample string
    myCommandFlagVerbose bool
)

func init() {
    // Add command to root
    rootCmd.AddCommand(myCommandCmd)
    
    // Define flags
    myCommandCmd.Flags().StringVarP(&myCommandFlagExample, "example", "e", "", "example flag description")
    myCommandCmd.Flags().BoolVarP(&myCommandFlagVerbose, "verbose", "v", false, "enable verbose output")
}

func myCommandRun(cmd *cobra.Command, args []string) (rtnErr error) {
    // Always track activity for telemetry
    defer func() {
        sendActivity("mycommand", rtnErr == nil)
    }()
    
    // Validate arguments
    if len(args) == 0 {
        OutputHelpMessage(cmd)
        return fmt.Errorf("requires at least one argument")
    }
    
    // Command implementation
    fmt.Printf("Command executed successfully\n")
    return nil
}
```

**File Naming Convention:**
- Use `wshcmd-[commandname].go` format
- Use lowercase, hyphenated names for multi-word commands
- Examples: `wshcmd-getvar.go`, `wshcmd-setmeta.go`, `wshcmd-ai.go`

### Step 2: Command Structure

#### Basic Command Structure

```go
var myCommandCmd = &cobra.Command{
    Use:   "mycommand [required] [optional...]",
    Short: "One-line description (shown in help)",
    Long:  `Detailed multi-line description`,
    
    // Argument validation
    Args:    cobra.MinimumNArgs(1),  // Or cobra.ExactArgs(1), cobra.NoArgs, etc.
    
    // Execution function
    RunE:    myCommandRun,
    
    // Pre-execution setup (if needed)
    PreRunE: preRunSetupRpcClient,  // Sets up RPC client for backend communication
    
    // Example usage (optional)
    Example: "  wsh mycommand foo\n  wsh mycommand --flag bar",
    
    // Disable flag notation in usage line
    DisableFlagsInUseLine: true,
}
```

**Key Fields:**
- `Use`: Command name and argument pattern
- `Short`: Brief description for command list
- `Long`: Detailed description shown in help
- `Args`: Argument validator (optional)
- `RunE`: Main execution function (returns error)
- `PreRunE`: Setup function that runs before `RunE`
- `Example`: Usage examples (optional)
- `DisableFlagsInUseLine`: Clean up help display

#### When to Use PreRunE

Include `PreRunE: preRunSetupRpcClient` if your command:
- Communicates with the Wave Terminal backend
- Needs access to `RpcClient` 
- Requires JWT authentication (WAVETERM_JWT env var)
- Makes RPC calls via `wshclient.*Command()` functions

**Don't include PreRunE** for commands that:
- Only manipulate local state
- Don't need backend communication
- Are purely informational/local operations

### Step 3: Implement Command Logic

#### Command Function Pattern

```go
func myCommandRun(cmd *cobra.Command, args []string) (rtnErr error) {
    // Step 1: Always track activity (for telemetry)
    defer func() {
        sendActivity("mycommand", rtnErr == nil)
    }()
    
    // Step 2: Validate arguments and flags
    if len(args) != 1 {
        OutputHelpMessage(cmd)
        return fmt.Errorf("requires exactly one argument")
    }
    
    // Step 3: Parse/prepare data
    targetArg := args[0]
    
    // Step 4: Make RPC call if needed
    result, err := wshclient.SomeCommand(RpcClient, wshrpc.CommandSomeData{
        Field: targetArg,
    }, &wshrpc.RpcOpts{Timeout: 2000})
    if err != nil {
        return fmt.Errorf("executing command: %w", err)
    }
    
    // Step 5: Output results
    fmt.Printf("Result: %s\n", result)
    return nil
}
```

**Important Patterns:**

1. **Activity Tracking**: Always include deferred `sendActivity()` call
   ```go
   defer func() {
       sendActivity("commandname", rtnErr == nil)
   }()
   ```

2. **Error Handling**: Return errors, don't call `os.Exit()`
   ```go
   if err != nil {
       return fmt.Errorf("context: %w", err)
   }
   ```

3. **Output**: Use standard `fmt` package for output
   ```go
   fmt.Printf("Success message\n")
   fmt.Fprintf(os.Stderr, "Error message\n")
   ```

4. **Help Messages**: Show help when arguments are invalid
   ```go
   if len(args) == 0 {
       OutputHelpMessage(cmd)
       return fmt.Errorf("requires arguments")
   }
   ```

5. **Exit Codes**: Set custom exit code via `WshExitCode`
   ```go
   if notFound {
       WshExitCode = 1
       return nil  // Don't return error, just set exit code
   }
   ```

### Step 4: Define Flags

Add flags in the `init()` function:

```go
var (
    // Declare flag variables at package level
    myCommandFlagString string
    myCommandFlagBool   bool
    myCommandFlagInt    int
)

func init() {
    rootCmd.AddCommand(myCommandCmd)
    
    // String flag with short version
    myCommandCmd.Flags().StringVarP(&myCommandFlagString, "name", "n", "default", "description")
    
    // Boolean flag
    myCommandCmd.Flags().BoolVarP(&myCommandFlagBool, "verbose", "v", false, "enable verbose")
    
    // Integer flag
    myCommandCmd.Flags().IntVar(&myCommandFlagInt, "count", 10, "set count")
    
    // Flag without short version
    myCommandCmd.Flags().StringVar(&myCommandFlagString, "longname", "", "description")
}
```

**Flag Types:**
- `StringVar/StringVarP` - String values
- `BoolVar/BoolVarP` - Boolean flags
- `IntVar/IntVarP` - Integer values
- The `P` suffix versions include a short flag name

**Flag Naming:**
- Use camelCase for variable names: `myCommandFlagName`
- Use kebab-case for flag names: `--flag-name`
- Prefix variable names with command name for clarity

### Step 5: Working with Block Arguments

Many commands operate on blocks. Use the standard block resolution pattern:

```go
func myCommandRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("mycommand", rtnErr == nil)
    }()
    
    // Resolve block using the -b/--block flag
    fullORef, err := resolveBlockArg()
    if err != nil {
        return err
    }
    
    // Use the blockid in RPC call
    err = wshclient.SomeCommand(RpcClient, wshrpc.CommandSomeData{
        BlockId: fullORef.OID,
    }, &wshrpc.RpcOpts{Timeout: 2000})
    if err != nil {
        return fmt.Errorf("command failed: %w", err)
    }
    
    return nil
}
```

**Block Resolution:**
- The `-b/--block` flag is defined globally in `wshcmd-root.go`
- `resolveBlockArg()` resolves the block argument to a full ORef
- Supports: `this`, `tab`, full UUIDs, 8-char prefixes, block numbers
- Default is `"this"` (current block)

**Alternative: Manual Block Resolution**

```go
// Get tab ID from environment
tabId := os.Getenv("WAVETERM_TABID")
if tabId == "" {
    return fmt.Errorf("WAVETERM_TABID not set")
}

// Create route for tab-level operations
route := wshutil.MakeTabRouteId(tabId)

// Use route in RPC call
err := wshclient.SomeCommand(RpcClient, commandData, &wshrpc.RpcOpts{
    Route:   route,
    Timeout: 2000,
})
```

### Step 6: Making RPC Calls

Use the `wshclient` package to make RPC calls:

```go
import (
    "github.com/wavetermdev/waveterm/pkg/wshrpc"
    "github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// Simple RPC call
result, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{
    ORef: *fullORef,
}, &wshrpc.RpcOpts{Timeout: 2000})
if err != nil {
    return fmt.Errorf("getting metadata: %w", err)
}

// RPC call with routing
err := wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
    ORef: *fullORef,
    Meta: metaMap,
}, &wshrpc.RpcOpts{
    Route:   route,
    Timeout: 5000,
})
if err != nil {
    return fmt.Errorf("setting metadata: %w", err)
}
```

**RPC Options:**
- `Timeout`: Request timeout in milliseconds (typically 2000-5000)
- `Route`: Route ID for targeting specific components
- Available routes: `wshutil.ControlRoute`, `wshutil.MakeTabRouteId(tabId)`

### Step 7: Add Documentation

Add your command to `docs/docs/wsh-reference.mdx`:

````markdown
## mycommand

Brief description of what the command does.

```sh
wsh mycommand [args] [flags]
```

Detailed explanation of the command's purpose and behavior.

Flags:
- `-n, --name <value>` - description of this flag
- `-v, --verbose` - enable verbose output
- `-b, --block <blockid>` - specify target block (default: current block)

Examples:

```sh
# Basic usage
wsh mycommand arg1

# With flags
wsh mycommand --name value arg1

# With block targeting
wsh mycommand -b 2 arg1

# Complex example
wsh mycommand -v --name "example" arg1 arg2
```

Additional notes, tips, or warnings about the command.

---
````

**Documentation Guidelines:**
- Place in alphabetical order with other commands
- Include command signature with argument pattern
- List all flags with short and long versions
- Provide practical examples (at least 3-5)
- Explain common use cases and patterns
- Add tips or warnings if relevant
- Use `---` separator between commands

### Step 8: Test Your Command

Build and test the command:

```bash
# Build wsh
task build:wsh

# Or build everything
task build

# Test the command
./bin/wsh/wsh mycommand --help
./bin/wsh/wsh mycommand arg1 arg2
```

**Testing Checklist:**
- [ ] Help message displays correctly
- [ ] Required arguments validated
- [ ] Flags work as expected
- [ ] Error messages are clear
- [ ] Success cases work correctly
- [ ] RPC calls complete successfully
- [ ] Output is formatted correctly

## Complete Examples

### Example 1: Simple Command with No RPC

**Use case:** A command that prints Wave Terminal version info

#### Command File (`cmd/wsh/cmd/wshcmd-version.go`)

```go
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
    "github.com/spf13/cobra"
    "github.com/wavetermdev/waveterm/pkg/wavebase"
)

var versionCmd = &cobra.Command{
    Use:   "version",
    Short: "Print Wave Terminal version",
    RunE:  versionRun,
}

func init() {
    rootCmd.AddCommand(versionCmd)
}

func versionRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("version", rtnErr == nil)
    }()
    
    fmt.Printf("Wave Terminal %s\n", wavebase.WaveVersion)
    return nil
}
```

#### Documentation

````markdown
## version

Print the current Wave Terminal version.

```sh
wsh version
```

Examples:

```sh
# Print version
wsh version
```
````

### Example 2: Command with Flags and RPC

**Use case:** A command to update block title

#### Command File (`cmd/wsh/cmd/wshcmd-settitle.go`)

```go
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
    "fmt"

    "github.com/spf13/cobra"
    "github.com/wavetermdev/waveterm/pkg/wshrpc"
    "github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var setTitleCmd = &cobra.Command{
    Use:   "settitle [title]",
    Short: "Set block title",
    Long:  `Set the title for the current or specified block.`,
    Args:  cobra.ExactArgs(1),
    RunE:  setTitleRun,
    PreRunE: preRunSetupRpcClient,
    DisableFlagsInUseLine: true,
}

var setTitleIcon string

func init() {
    rootCmd.AddCommand(setTitleCmd)
    setTitleCmd.Flags().StringVarP(&setTitleIcon, "icon", "i", "", "set block icon")
}

func setTitleRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("settitle", rtnErr == nil)
    }()
    
    title := args[0]
    
    // Resolve block
    fullORef, err := resolveBlockArg()
    if err != nil {
        return err
    }
    
    // Build metadata map
    meta := make(map[string]interface{})
    meta["title"] = title
    if setTitleIcon != "" {
        meta["icon"] = setTitleIcon
    }
    
    // Make RPC call
    err = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
        ORef: *fullORef,
        Meta: meta,
    }, &wshrpc.RpcOpts{Timeout: 2000})
    if err != nil {
        return fmt.Errorf("setting title: %w", err)
    }
    
    fmt.Printf("title updated\n")
    return nil
}
```

#### Documentation

````markdown
## settitle

Set the title for a block.

```sh
wsh settitle [title]
```

Update the display title for the current or specified block. Optionally set an icon as well.

Flags:
- `-i, --icon <icon>` - set block icon along with title
- `-b, --block <blockid>` - specify target block (default: current block)

Examples:

```sh
# Set title for current block
wsh settitle "My Terminal"

# Set title and icon
wsh settitle --icon "terminal" "Development Shell"

# Set title for specific block
wsh settitle -b 2 "Build Output"
```
````

### Example 3: Subcommands

**Use case:** Command with multiple subcommands (like `wsh conn`)

#### Command File (`cmd/wsh/cmd/wshcmd-mygroup.go`)

```go
// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
    "fmt"

    "github.com/spf13/cobra"
    "github.com/wavetermdev/waveterm/pkg/wshrpc"
    "github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var myGroupCmd = &cobra.Command{
    Use:   "mygroup",
    Short: "Manage something",
}

var myGroupListCmd = &cobra.Command{
    Use:   "list",
    Short: "List items",
    RunE:  myGroupListRun,
    PreRunE: preRunSetupRpcClient,
}

var myGroupAddCmd = &cobra.Command{
    Use:   "add [name]",
    Short: "Add an item",
    Args:  cobra.ExactArgs(1),
    RunE:  myGroupAddRun,
    PreRunE: preRunSetupRpcClient,
}

func init() {
    // Add parent command
    rootCmd.AddCommand(myGroupCmd)
    
    // Add subcommands
    myGroupCmd.AddCommand(myGroupListCmd)
    myGroupCmd.AddCommand(myGroupAddCmd)
}

func myGroupListRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("mygroup:list", rtnErr == nil)
    }()
    
    // Implementation
    fmt.Printf("Listing items...\n")
    return nil
}

func myGroupAddRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("mygroup:add", rtnErr == nil)
    }()
    
    name := args[0]
    fmt.Printf("Adding item: %s\n", name)
    return nil
}
```

#### Documentation

````markdown
## mygroup

Manage something with subcommands.

### list

List all items.

```sh
wsh mygroup list
```

### add

Add a new item.

```sh
wsh mygroup add [name]
```

Examples:

```sh
# List items
wsh mygroup list

# Add an item
wsh mygroup add "new-item"
```
````

## Common Patterns

### Reading from Stdin

```go
import "io"

func myCommandRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("mycommand", rtnErr == nil)
    }()
    
    // Check if reading from stdin (using "-" convention)
    var data []byte
    var err error
    
    if len(args) > 0 && args[0] == "-" {
        data, err = io.ReadAll(os.Stdin)
        if err != nil {
            return fmt.Errorf("reading stdin: %w", err)
        }
    } else {
        // Read from file or other source
        data, err = os.ReadFile(args[0])
        if err != nil {
            return fmt.Errorf("reading file: %w", err)
        }
    }
    
    // Process data
    fmt.Printf("Read %d bytes\n", len(data))
    return nil
}
```

### JSON File Input

```go
import (
    "encoding/json"
    "io"
)

func loadJSONFile(filepath string) (map[string]interface{}, error) {
    var data []byte
    var err error
    
    if filepath == "-" {
        data, err = io.ReadAll(os.Stdin)
        if err != nil {
            return nil, fmt.Errorf("reading stdin: %w", err)
        }
    } else {
        data, err = os.ReadFile(filepath)
        if err != nil {
            return nil, fmt.Errorf("reading file: %w", err)
        }
    }
    
    var result map[string]interface{}
    if err := json.Unmarshal(data, &result); err != nil {
        return nil, fmt.Errorf("parsing JSON: %w", err)
    }
    
    return result, nil
}
```

### Conditional Output (TTY Detection)

```go
func myCommandRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("mycommand", rtnErr == nil)
    }()
    
    isTty := getIsTty()
    
    // Output value
    fmt.Printf("%s", value)
    
    // Add newline only if TTY (for better piping experience)
    if isTty {
        fmt.Printf("\n")
    }
    
    return nil
}
```

### Environment Variable Access

```go
func myCommandRun(cmd *cobra.Command, args []string) (rtnErr error) {
    defer func() {
        sendActivity("mycommand", rtnErr == nil)
    }()
    
    // Get block ID from environment
    blockId := os.Getenv("WAVETERM_BLOCKID")
    if blockId == "" {
        return fmt.Errorf("WAVETERM_BLOCKID not set")
    }
    
    // Get tab ID from environment
    tabId := os.Getenv("WAVETERM_TABID")
    if tabId == "" {
        return fmt.Errorf("WAVETERM_TABID not set")
    }
    
    fmt.Printf("Block: %s, Tab: %s\n", blockId, tabId)
    return nil
}
```

## Best Practices

### Command Design

1. **Single Responsibility**: Each command should do one thing well
2. **Composable**: Design commands to work with pipes and other commands
3. **Consistent**: Follow existing wsh command patterns and conventions
4. **Documented**: Provide clear help text and examples

### Error Handling

1. **Context**: Wrap errors with context using `fmt.Errorf("context: %w", err)`
2. **User-Friendly**: Make error messages clear and actionable
3. **No Panics**: Return errors instead of calling `os.Exit()` or `panic()`
4. **Exit Codes**: Use `WshExitCode` for custom exit codes

### Output

1. **Structured**: Use consistent formatting for output
2. **Quiet by Default**: Only output what's necessary
3. **Verbose Flag**: Optionally provide `-v` for detailed output
4. **Stderr for Errors**: Use `fmt.Fprintf(os.Stderr, ...)` for error messages

### Flags

1. **Short Versions**: Provide `-x` short versions for common flags
2. **Sensible Defaults**: Choose defaults that work for most users
3. **Boolean Flags**: Use for on/off options
4. **String Flags**: Use for values that need user input

### RPC Calls

1. **Timeouts**: Always specify reasonable timeouts
2. **Error Context**: Wrap RPC errors with operation context
3. **Retries**: Don't retry automatically; let user retry command
4. **Routes**: Use appropriate routes for different operations

## Common Pitfalls

### 1. Forgetting Activity Tracking

**Problem**: Command usage not tracked in telemetry

**Solution**: Always include deferred `sendActivity()` call:
```go
defer func() {
    sendActivity("commandname", rtnErr == nil)
}()
```

### 2. Using os.Exit() Instead of Returning Error

**Problem**: Breaks defer statements and cleanup

**Solution**: Return errors from RunE function:
```go
// Bad
if err != nil {
    fmt.Fprintf(os.Stderr, "error: %v\n", err)
    os.Exit(1)
}

// Good
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}
```

### 3. Not Validating Arguments

**Problem**: Command crashes with nil pointer or index out of range

**Solution**: Validate arguments early and show help:
```go
if len(args) == 0 {
    OutputHelpMessage(cmd)
    return fmt.Errorf("requires at least one argument")
}
```

### 4. Forgetting to Add to init()

**Problem**: Command not available when running wsh

**Solution**: Always add command in `init()` function:
```go
func init() {
    rootCmd.AddCommand(myCommandCmd)
}
```

### 5. Inconsistent Output

**Problem**: Inconsistent use of output methods

**Solution**: Use standard `fmt` package functions:
```go
// For stdout
fmt.Printf("output\n")

// For stderr
fmt.Fprintf(os.Stderr, "error message\n")
```

## Quick Reference Checklist

When adding a new wsh command:

- [ ] Create `cmd/wsh/cmd/wshcmd-[commandname].go`
- [ ] Define command struct with Use, Short, Long descriptions
- [ ] Add `PreRunE: preRunSetupRpcClient` if using RPC
- [ ] Implement command function with activity tracking
- [ ] Add command to `rootCmd` in `init()` function
- [ ] Define flags in `init()` function if needed
- [ ] Add documentation to `docs/docs/wsh-reference.mdx`
- [ ] Build and test: `task build:wsh`
- [ ] Test help: `wsh [commandname] --help`
- [ ] Test all flag combinations
- [ ] Test error cases

## Related Files

- **Root Command**: `cmd/wsh/cmd/wshcmd-root.go` - Main command setup and utilities
- **RPC Client**: `pkg/wshrpc/wshclient/` - Client functions for RPC calls
- **RPC Types**: `pkg/wshrpc/wshrpctypes.go` - RPC request/response data structures
- **Documentation**: `docs/docs/wsh-reference.mdx` - User-facing command reference
- **Examples**: `cmd/wsh/cmd/wshcmd-*.go` - Existing command implementations
