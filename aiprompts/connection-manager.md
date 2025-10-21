# Connections Manager Design

## Overview

Wave Terminal currently requires users to manually edit `connections.json` to manage SSH/WSL connection settings. This document outlines the architecture for a graphical connections manager that will make adding, editing, and removing connections user-friendly.

## Current Architecture

### Connection Storage

Connections are stored in `~/.config/waveterm/connections.json` with the following structure:

```json
{
  "user@hostname:port": {
    "conn:wshenabled": true,
    "conn:askbeforewshinstall": true,
    "conn:wshpath": "~/.waveterm/bin/wsh",
    "conn:shellpath": "/bin/bash",
    "display:hidden": false,
    "display:order": 0,
    "term:fontsize": 14,
    "term:theme": "default",
    "ssh:hostname": "192.168.1.100",
    "ssh:port": "22",
    "ssh:user": "username",
    "ssh:identityfile": ["~/.ssh/id_rsa"],
    ...
  }
}
```

### Connection Types

1. **SSH Connections** - Format: `[user]@[host]:[port]`
2. **WSL Connections** - Format: `wsl://[distro-name]`
3. **AWS S3 Connections** - Format: `aws:[profile]` (not stored in connections.json)
4. **Local Connection** - Empty string or null

### Key Files

#### Backend (Go)
- **`pkg/wconfig/settingsconfig.go`** - Configuration management
  - `ConnKeywords` struct (lines 256-294) - Defines all connection settings
  - `SetConnectionsConfigValue()` - Writes connection config
  - `ReadWaveHomeConfigFile()` - Reads connections.json
  - `WriteWaveHomeConfigFile()` - Writes connections.json with proper formatting

- **`pkg/remote/conncontroller/conncontroller.go`** - SSH connection management
  - `SSHConn` struct - Manages SSH connection state
  - `GetConnectionsList()` - Returns all available connections
  - `GetConnectionsFromInternalConfig()` - Gets connections from connections.json
  - `GetConnectionsFromConfig()` - Gets connections from ~/.ssh/config

- **`pkg/remote/sshclient.go`** - SSH client implementation
  - `findSshConfigKeywords()` - Parses SSH config files
  - `ConnectToClient()` - Establishes SSH connections
  - SSH authentication and known_hosts handling

- **`pkg/wslconn/wslconn.go`** - WSL connection management
  - Similar structure to SSH connections
  - `WslConn` struct for WSL-specific state

- **`cmd/wsh/cmd/wshcmd-ssh.go`** - CLI command for SSH connections
  - `wsh ssh` command implementation
  - Shows how connections are created from CLI

#### Frontend (TypeScript/React)
- **`frontend/app/modals/conntypeahead.tsx`** - Connection selector dropdown
  - Current UI for selecting connections
  - `ChangeConnectionBlockModal` component
  - Filters, sorts, and displays available connections
  - "Edit Connections" link that opens connections.json in editor

- **`frontend/app/store/global.ts`** - Global state management
  - `getConnStatusAtom()` - Per-connection status atoms
  - `ConnStatusMapAtom` - Map of all connection statuses

#### RPC Layer
- **`pkg/wshrpc/wshrpctypes.go`** - RPC interface definitions
  - `Command_ConnStatus` - Get connection status
  - `Command_ConnEnsure` - Ensure connection is established
  - `Command_ConnConnect` - Connect to a host
  - `Command_ConnDisconnect` - Disconnect from a host
  - `Command_ConnList` - List available connections
  - `Command_WslList` - List WSL distributions
  - `Command_ConnListAWS` - List AWS S3 profiles

### Connection Configuration Schema

The schema is defined in `schema/connections.json`:

```json
{
  "ConnKeywords": {
    "properties": {
      "conn:wshenabled": { "type": "boolean" },
      "conn:askbeforewshinstall": { "type": "boolean" },
      "conn:wshpath": { "type": "string" },
      "conn:shellpath": { "type": "string" },
      "conn:ignoresshconfig": { "type": "boolean" },
      "display:hidden": { "type": "boolean" },
      "display:order": { "type": "number" },
      "term:fontsize": { "type": "number" },
      "term:fontfamily": { "type": "string" },
      "term:theme": { "type": "string" },
      "cmd:env": { "type": "object" },
      "cmd:initscript": { "type": "string" },
      "ssh:user": { "type": "string" },
      "ssh:hostname": { "type": "string" },
      "ssh:port": { "type": "string" },
      "ssh:identityfile": { "type": "array" },
      "ssh:batchmode": { "type": "boolean" },
      "ssh:pubkeyauthentication": { "type": "boolean" },
      ...
    }
  }
}
```

### Connection Name Resolution

Connection names are normalized to: `user@hostname:port`

1. SSH config parsing (`~/.ssh/config` and `/etc/ssh/ssh_config`)
2. Internal config (`connections.json`) overrides SSH config
3. Command-line flags override both
4. Successfully connected hosts are auto-saved to `connections.json`

## Proposed Design: Graphical Connections Manager

### User Interface Components

#### 1. Connections Manager Modal

A new modal component for managing all connections:

**Structure:**
```
┌─────────────────────────────────────────────┐
│  Connections Manager                    [X] │
├─────────────────────────────────────────────┤
│                                             │
│  [Search connections...]          [+ Add]  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ SSH Connections                      │  │
│  ├──────────────────────────────────────┤  │
│  │ ● user@server1.com:22      [Edit] [X]│  │
│  │ ○ user@server2.com:2222    [Edit] [X]│  │
│  │ ○ root@192.168.1.100:22    [Edit] [X]│  │
│  └──────────────────────────────────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ WSL Connections                      │  │
│  ├──────────────────────────────────────┤  │
│  │ ● wsl://Ubuntu               [Edit] [X]│  │
│  │ ○ wsl://Debian               [Edit] [X]│  │
│  └──────────────────────────────────────┘  │
│                                             │
│                              [Close]        │
└─────────────────────────────────────────────┘
```

**Features:**
- List all connections grouped by type (SSH, WSL)
- Visual status indicators (connected ●, disconnected ○)
- Search/filter functionality
- Quick actions: Connect, Edit, Delete
- Drag to reorder (updates `display:order`)

#### 2. Connection Editor Modal

A form-based editor for creating/editing connections:

**Structure:**
```
┌─────────────────────────────────────────────┐
│  Edit Connection: user@server.com       [X] │
├─────────────────────────────────────────────┤
│                                             │
│  Connection Type: [SSH ▼]                  │
│                                             │
│  ━━━ Basic Settings ━━━━━━━━━━━━━━━━━━━━━  │
│  Host:     [server.com                  ]  │
│  Port:     [22                          ]  │
│  User:     [myuser                      ]  │
│                                             │
│  ━━━ Authentication ━━━━━━━━━━━━━━━━━━━━━  │
│  Identity Files:                            │
│    [~/.ssh/id_rsa                       ]  │
│    [+ Add identity file]                   │
│                                             │
│  □ Use only specified identity files       │
│  □ Add keys to SSH agent                   │
│  □ Password authentication                 │
│  □ Keyboard-interactive auth               │
│                                             │
│  ━━━ Advanced Settings ━━━━━━━━━━━━━━━━━━  │
│  □ Use SSH config file                     │
│  □ Enable WSH shell extensions             │
│  Shell Path: [                          ]  │
│  WSH Path:   [~/.waveterm/bin/wsh       ]  │
│                                             │
│  ━━━ Terminal Settings ━━━━━━━━━━━━━━━━━━  │
│  Theme:      [default ▼]                   │
│  Font Size:  [14     ]                     │
│  Font Family:[                          ]  │
│                                             │
│  ━━━ Environment & Scripts ━━━━━━━━━━━━━━  │
│  Environment Variables:                     │
│    KEY        VALUE                 [+ Add]│
│  Init Script: [                         ]  │
│                                             │
│  ━━━ Display ━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  □ Hide from connection list               │
│  Display Order: [0                      ]  │
│                                             │
│           [Test Connection]  [Cancel] [Save]│
└─────────────────────────────────────────────┘
```

**Sections:**
1. **Basic Settings** - Host, port, user
2. **Authentication** - Identity files, auth methods
3. **Advanced Settings** - SSH config, WSH, shell
4. **Terminal Settings** - Theme, font customization
5. **Environment & Scripts** - Env vars, init scripts
6. **Display** - Hide connection, reorder
7. **Actions** - Test, Cancel, Save

#### 3. Quick Add Connection Dialog

A simplified dialog for quickly adding common connections:

```
┌─────────────────────────────────────────────┐
│  Add Connection                         [X] │
├─────────────────────────────────────────────┤
│                                             │
│  Connection String:                         │
│  [user@hostname:port                    ]  │
│                                             │
│  Or select WSL distribution:                │
│  [ Ubuntu ▼                              ]  │
│                                             │
│                      [Advanced] [Connect]  │
└─────────────────────────────────────────────┘
```

**Features:**
- Parse connection string (user@host:port)
- Auto-detect WSL distributions
- "Advanced" button opens full editor
- "Connect" button creates and connects immediately

### Implementation Components

#### Frontend Components

1. **`frontend/app/modals/connectionsmodal.tsx`**
   - Main connections manager modal
   - Connection list with status indicators
   - Search and filter functionality
   - Integration with global connection state

2. **`frontend/app/modals/connectioneditor.tsx`**
   - Form-based connection editor
   - Validation for all fields
   - Preview of connection string
   - Test connection button

3. **`frontend/app/modals/quickaddconnection.tsx`**
   - Simplified connection creation dialog
   - Connection string parser
   - WSL distribution selector

#### Backend RPC Commands

Add new commands to `wshrpctypes.go`:

```go
Command_ConnCreate = "conncreate"  // Create new connection
Command_ConnUpdate = "connupdate"  // Update existing connection  
Command_ConnDelete = "conndelete"  // Delete connection
Command_ConnTest   = "conntest"    // Test connection without saving
Command_ConnParse  = "connparse"   // Parse connection string
```

#### Data Structures

```typescript
// frontend/types/gotypes.d.ts (generated from Go)
interface ConnectionConfig {
  // Connection settings
  "conn:wshenabled"?: boolean;
  "conn:askbeforewshinstall"?: boolean;
  "conn:wshpath"?: string;
  "conn:shellpath"?: string;
  "conn:ignoresshconfig"?: boolean;
  
  // Display settings
  "display:hidden"?: boolean;
  "display:order"?: number;
  
  // Terminal settings
  "term:fontsize"?: number;
  "term:fontfamily"?: string;
  "term:theme"?: string;
  
  // Environment
  "cmd:env"?: Record<string, string>;
  "cmd:initscript"?: string;
  
  // SSH settings
  "ssh:user"?: string;
  "ssh:hostname"?: string;
  "ssh:port"?: string;
  "ssh:identityfile"?: string[];
  "ssh:batchmode"?: boolean;
  "ssh:pubkeyauthentication"?: boolean;
  "ssh:passwordauthentication"?: boolean;
  "ssh:kbdinteractiveauthentication"?: boolean;
  "ssh:preferredauthentications"?: string[];
  "ssh:addkeystoagent"?: boolean;
  "ssh:identityagent"?: string;
  "ssh:identitiesonly"?: boolean;
  "ssh:proxyjump"?: string[];
  "ssh:userknownhostsfile"?: string[];
  "ssh:globalknownhostsfile"?: string[];
}

interface ConnectionInfo {
  name: string;  // normalized connection name
  type: "ssh" | "wsl" | "local";
  config: ConnectionConfig;
  status?: ConnStatus;
}

interface CommandConnCreateData {
  conntype: string;  // "ssh" or "wsl"
  connstring: string;  // user@host:port or wsl://distro
  config?: ConnectionConfig;
}

interface CommandConnUpdateData {
  connname: string;
  config: ConnectionConfig;
}

interface CommandConnDeleteData {
  connname: string;
}

interface CommandConnTestData {
  conntype: string;
  connstring: string;
  config?: ConnectionConfig;
}

interface CommandConnParseData {
  connstring: string;
}

interface CommandConnParseResult {
  type: string;
  user?: string;
  hostname?: string;
  port?: string;
  distro?: string;
  valid: boolean;
  error?: string;
}
```

#### Backend Implementation

1. **`pkg/wconfig/connmanager.go`** (new file)
   ```go
   package wconfig
   
   // CreateConnection creates a new connection entry
   func CreateConnection(connName string, config ConnKeywords) error
   
   // UpdateConnection updates an existing connection
   func UpdateConnection(connName string, config ConnKeywords) error
   
   // DeleteConnection removes a connection entry
   func DeleteConnection(connName string) error
   
   // GetConnection retrieves a single connection config
   func GetConnection(connName string) (ConnKeywords, error)
   
   // ListConnections returns all configured connections
   func ListConnections() (map[string]ConnKeywords, error)
   
   // ParseConnectionString parses a connection string
   func ParseConnectionString(connStr string) (ConnInfo, error)
   
   // TestConnection tests if connection parameters are valid
   func TestConnection(connType, connStr string, config ConnKeywords) error
   
   // ValidateConnectionConfig validates connection configuration
   func ValidateConnectionConfig(config ConnKeywords) error
   ```

2. **RPC Handlers** in appropriate server files
   - Implement handlers for new commands
   - Use existing `wconfig` functions where possible
   - Add proper error handling and validation

### User Workflows

#### 1. Add New SSH Connection

1. User clicks "Add Connection" or uses connection dropdown
2. Quick add dialog appears
3. User enters: `user@hostname:port`
4. System parses and validates
5. User clicks "Connect" (or "Advanced" for more options)
6. Connection is saved to `connections.json`
7. Connection is established
8. Success notification shown

#### 2. Edit Existing Connection

1. User opens Connections Manager
2. User finds connection in list
3. User clicks "Edit" button
4. Connection Editor opens with current settings
5. User modifies settings (e.g., adds identity file)
6. User clicks "Save"
7. Changes written to `connections.json`
8. If connection is active, prompt to reconnect

#### 3. Delete Connection

1. User opens Connections Manager
2. User finds connection in list
3. User clicks "Delete" (X) button
4. Confirmation dialog appears
5. If confirmed, entry removed from `connections.json`
6. If connection is active, it's disconnected first

#### 4. Reorder Connections

1. User opens Connections Manager
2. User drags connection to new position
3. `display:order` values updated automatically
4. Changes saved to `connections.json`

### Migration from Current System

**Phase 1: Backend Infrastructure**
- Implement new RPC commands
- Create `pkg/wconfig/connmanager.go`
- Add validation and parsing functions
- Write unit tests

**Phase 2: Basic UI**
- Create Connections Manager modal
- Implement connection list view
- Add search/filter functionality
- Connect to backend RPC

**Phase 3: Editor UI**
- Create Connection Editor modal
- Implement all form fields
- Add validation
- Add "Test Connection" functionality

**Phase 4: Integration**
- Update connection dropdown to link to manager
- Add "Add Connection" button to UI
- Replace "Edit Connections" link
- Add keyboard shortcuts

**Phase 5: Polish**
- Add drag-and-drop reordering
- Improve error messages
- Add tooltips and help text
- User documentation

### Backwards Compatibility

- Existing `connections.json` files remain valid
- Manual editing still supported
- SSH config files still parsed
- Connection strings still work in dropdowns

### Security Considerations

1. **Identity Files**
   - Never expose private key contents
   - Only store paths, not key material
   - Validate file permissions

2. **Passwords**
   - Never store passwords in connections.json
   - Always prompt at connection time
   - Use SSH agent when available

3. **Validation**
   - Validate all user input
   - Sanitize connection strings
   - Prevent path traversal in file fields

4. **Permissions**
   - Ensure connections.json has proper permissions (0600)
   - Verify SSH config file permissions
   - Check identity file permissions

### Testing Strategy

1. **Unit Tests**
   - Connection string parsing
   - Config validation
   - CRUD operations

2. **Integration Tests**
   - RPC command handlers
   - File I/O operations
   - Connection establishment

3. **E2E Tests**
   - Create connection via UI
   - Edit connection settings
   - Delete connection
   - Reorder connections

4. **Edge Cases**
   - Invalid connection strings
   - Duplicate connections
   - Missing SSH config
   - Connection conflicts

### Future Enhancements

1. **Import/Export**
   - Export connections to file
   - Import from SSH config
   - Share connection configs

2. **Connection Groups**
   - Organize connections into folders
   - Bulk operations on groups

3. **Connection Templates**
   - Save common configurations as templates
   - Quick create from template

4. **Connection History**
   - Track connection usage
   - Show recently used connections
   - Connection statistics

5. **Advanced Features**
   - SSH tunneling/port forwarding configuration
   - Jump host configuration UI
   - ProxyCommand configuration

## Summary

This design provides a comprehensive solution for managing connections graphically while maintaining compatibility with the existing system. The phased implementation approach allows for incremental development and testing, ensuring a smooth transition from manual JSON editing to a full-featured GUI.

The key improvements are:
- **User-friendly** - No need to manually edit JSON
- **Discoverable** - All options visible in UI
- **Safe** - Validation prevents errors
- **Flexible** - Supports both quick and advanced workflows
- **Compatible** - Works with existing connections.json and SSH configs