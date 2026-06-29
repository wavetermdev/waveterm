---
name: add-wshcmd
description: Guide for adding new wsh commands to Wave Terminal — create command files, parse arguments, register handlers, define subcommands. Use when implementing new CLI commands, adding command-line functionality, or extending the wsh command interface.
---

# Adding a New wsh Command to Wave Terminal

Key files: `cmd/wsh/cmd/wshcmd-*.go` (command implementations), `docs/docs/wsh-reference.mdx` (docs). Commands use Cobra, register in `init()`, and communicate with the backend via `RpcClient`.

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

Include `PreRunE: preRunSetupRpcClient` if the command makes RPC calls via `wshclient.*Command()`.

### Step 2: Working with Block Arguments

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

### Step 3: Add Documentation

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

### Step 6: Build and Test

```bash
task build:wsh
./bin/wsh/wsh mycommand --help
./bin/wsh/wsh mycommand arg1 arg2
```

## Complete Example: Command with Flags and RPC

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
