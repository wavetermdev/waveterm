# Windows Terminal Shell/Profile Detection Research

## Executive Summary

Windows Terminal uses a modular **Dynamic Profile Generator** system to automatically detect and create profiles for installed shells. The architecture consists of:

1. **Static Default Profiles** - Command Prompt and Windows PowerShell (defined in `defaults.json`)
2. **Dynamic Profile Generators** - Runtime detection for WSL, PowerShell Core, SSH hosts, Visual Studio, and Azure Cloud Shell

This document details the detection mechanisms, registry paths, file locations, and recommended approaches for implementing similar functionality in WaveTerm.

---

## Architecture Overview

### Generator Interface

All dynamic profile generators implement `IDynamicProfileGenerator` with four methods:

```cpp
class IDynamicProfileGenerator {
    std::wstring_view GetNamespace();      // Unique identifier (e.g., "Windows.Terminal.Wsl")
    std::wstring_view GetDisplayName();    // Human-readable name for UI
    std::wstring_view GetIcon();           // Icon resource path
    void GenerateProfiles(std::vector<Profile>& profiles);  // Profile creation
};
```

### Generator Initialization Order

From `CascadiaSettingsSerialization.cpp`:

```cpp
// Generators are executed in this order:
1. PowershellCoreProfileGenerator
2. WslDistroGenerator
3. AzureCloudShellGenerator
4. VisualStudioGenerator
5. SshHostGenerator (when Feature_DynamicSSHProfiles enabled)
```

### Profile Sources (Namespaces)

| Source ID | Generator | Description |
|-----------|-----------|-------------|
| `Windows.Terminal.PowershellCore` | PowershellCoreProfileGenerator | PowerShell 7+ |
| `Windows.Terminal.Wsl` | WslDistroGenerator | WSL distributions |
| `Windows.Terminal.Azure` | AzureCloudShellGenerator | Azure Cloud Shell |
| `Windows.Terminal.VisualStudio` | VisualStudioGenerator | VS Developer environments |
| `Windows.Terminal.SSH` | SshHostGenerator | SSH config hosts |

---

## Detection Mechanisms

### 1. Windows Subsystem for Linux (WSL)

**Detection Method:** Windows Registry enumeration

**Registry Path:**
```
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Lxss
```

**Structure:**
```
Lxss/
  {GUID-1}/
    DistributionName = "Ubuntu"
  {GUID-2}/
    DistributionName = "Debian"
  ...
```

**Algorithm:**
1. Open `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`
2. Enumerate subkeys (each is a GUID like `{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}`)
3. For each subkey, read `DistributionName` registry value
4. Filter out utility distros (prefixed with `docker-desktop`, `rancher-desktop`)
5. Generate profile with command: `C:\Windows\System32\wsl.exe -d {distName}`

**Why Registry vs `wsl.exe`:**
- `wsl.exe` can be slow on first launch (WSL service initialization)
- Registry access is instant and doesn't require subprocess
- PR #10967 switched to registry-based detection for performance

**Profile Configuration:**
```json
{
  "name": "Ubuntu",
  "commandline": "C:\\Windows\\System32\\wsl.exe -d Ubuntu",
  "startingDirectory": "~",
  "colorScheme": "Campbell",
  "icon": "ms-appx:///ProfileIcons/{guid}.png"
}
```

---

### 2. PowerShell Core (pwsh)

**Detection Method:** Multi-source file system and package manager search

**Search Locations (in priority order):**

| Source | Path Pattern | Notes |
|--------|--------------|-------|
| Traditional Install | `%ProgramFiles%\PowerShell\{version}\pwsh.exe` | Also checks `(x86)` and `(Arm)` variants |
| Microsoft Store | `%LocalAppData%\Microsoft\WindowsApps\pwsh.exe` | Package IDs: `Microsoft.PowerShell_8wekyb3d8bbwe`, `Microsoft.PowerShellPreview_8wekyb3d8bbwe` |
| Dotnet Global Tools | `%USERPROFILE%\.dotnet\tools\pwsh.exe` | |
| Scoop | `%USERPROFILE%\scoop\shims\pwsh.exe` | |

**Version Detection:**
- Parse versioned subdirectories (e.g., `PowerShell\7\`, `PowerShell\7-preview\`)
- Query Store packages via Windows Package Manager API
- Extract version from executable metadata

**Priority Sorting:**
1. Major version (highest first)
2. Distribution method (Store > Traditional > Scoop > Dotnet)
3. Architecture (native preferred)
4. Build type (stable over preview)

**Legacy GUID:**
- The "best" PowerShell instance receives legacy GUID `574e775e-4f2a-5b96-ac1e-a2962a402336`
- Named "PowerShell" (without version qualifier)

---

### 3. SSH Hosts

**Detection Method:** SSH config file parsing

**Config File Locations:**
```
%ProgramData%\ssh\ssh_config     (System-wide)
%UserProfile%\.ssh\config        (User-specific)
```

**SSH Executable Search:**
```
%SystemRoot%\System32\OpenSSH\ssh.exe    (Windows Optional Features)
%ProgramFiles%\OpenSSH\ssh.exe           (MSI x64)
%ProgramFiles(x86)%\OpenSSH\ssh.exe      (MSI x86 on x64)
```

**Config Parsing Algorithm:**
1. Read config file line by line
2. Match lines with regex: `^\s*(\w+)\s+([^\s]+.*[^\s])\s*$`
3. Track `Host` entries (aliases)
4. When `HostName` follows `Host`, store the host alias
5. Generate profile for each discovered host

**Profile Configuration:**
```json
{
  "name": "SSH - hostname",
  "commandline": "\"C:\\Windows\\System32\\OpenSSH\\ssh.exe\" hostname",
  "icon": "\uE977"
}
```

---

### 4. Visual Studio Developer Environments

**Detection Method:** COM Setup Configuration API

**API Usage:**
```cpp
#include <Setup.Configuration.h>

// Create COM interface
ISetupConfiguration2* setupConfig;
CoCreateInstance(__uuidof(SetupConfiguration), ...);

// Enumerate installations
IEnumSetupInstances* enumInstances;
setupConfig->EnumInstances(&enumInstances);

// Iterate and extract info
ISetupInstance* instance;
while (enumInstances->Next(1, &instance, NULL) == S_OK) {
    BSTR installPath, productVersion;
    instance->GetInstallationPath(&installPath);
    instance->GetInstallationVersion(&productVersion);
}
```

**Generates Two Profile Types per VS Instance:**
1. **Developer Command Prompt** (`VsDevCmdGenerator`)
2. **Developer PowerShell** (`VsDevShellGenerator`)

**Developer PowerShell Command Line:**
```powershell
# Detects pwsh.exe or falls back to powershell.exe
pwsh.exe -NoExit -Command "& { Import-Module """C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"""; Enter-VsDevShell -InstanceId {instanceId} -SkipAutomaticLocation }"
```

---

### 5. Azure Cloud Shell

**Detection Method:** Platform availability check

```cpp
if (AzureConnection::IsAzureConnectionAvailable()) {
    // Generate Azure Cloud Shell profile
}
```

The actual availability check is implemented in the `AzureConnection` class and likely verifies Azure CLI installation or connectivity requirements.

---

### 6. Static Default Profiles (Command Prompt & Windows PowerShell)

**Not Dynamically Detected** - Defined in `defaults.json`:

```json
{
  "profiles": [
    {
      "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}",
      "name": "Windows PowerShell",
      "commandline": "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    },
    {
      "guid": "{0caa0dad-35be-5f56-a8ff-afceeeaa6101}",
      "name": "Command Prompt",
      "commandline": "%SystemRoot%\\System32\\cmd.exe"
    }
  ]
}
```

---

## Not Implemented: Git Bash Auto-Detection

Git Bash is **NOT** auto-detected by Windows Terminal. This is a frequently requested feature (Issue #1394).

**Proposed Detection Method (from community discussion):**

**Registry Path:**
```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Git_is1
  InstallLocation = "C:\Program Files\Git"
```

**Alternative Registry Paths:**
```
HKEY_LOCAL_MACHINE\SOFTWARE\GitForWindows
  InstallPath = "C:\Program Files\Git"

HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Git_is1
  InstallLocation = ...
```

**Recommended Profile Configuration:**
```json
{
  "name": "Git Bash",
  "commandline": "C:\\Program Files\\Git\\bin\\bash.exe",
  "icon": "C:\\Program Files\\Git\\mingw64\\share\\git\\git-for-windows.ico",
  "startingDirectory": "%HOMEDRIVE%%HOMEPATH%"
}
```

**Important:** Use `bin\bash.exe`, NOT `git-bash.exe` (which launches mintty separately).

---

## GUID Generation

Windows Terminal generates deterministic GUIDs for dynamic profiles using UUID v5:

```cpp
// Namespace GUID for Terminal profiles
static constexpr GUID TERMINAL_PROFILE_NAMESPACE_GUID = {...};

// Generate profile GUID from name
GUID profileGuid = CreateV5Uuid(
    TERMINAL_PROFILE_NAMESPACE_GUID,
    profileName
);
```

This ensures the same profile always gets the same GUID, enabling user customizations to persist across restarts.

---

## Disabling Profile Generators

Users can disable generators via `disabledProfileSources`:

```json
{
  "disabledProfileSources": [
    "Windows.Terminal.Wsl",
    "Windows.Terminal.Azure",
    "Windows.Terminal.PowershellCore",
    "Windows.Terminal.SSH",
    "Windows.Terminal.VisualStudio"
  ]
}
```

---

## Cross-Platform Considerations

### Windows-Specific

| Component | Windows-Only | Cross-Platform Alternative |
|-----------|--------------|---------------------------|
| WSL Registry | Yes | N/A (WSL is Windows-only) |
| PowerShell Store packages | Yes | File system scan only |
| VS Setup Configuration COM | Yes | N/A |
| Azure Cloud Shell | Partial | Azure CLI detection |
| SSH config parsing | No | Same approach works |

### Portable Approaches

1. **SSH Config Parsing** - Works on all platforms (`~/.ssh/config`)
2. **File System Scanning** - PowerShell 7 installs to predictable paths on all platforms
3. **Environment Variables** - Check PATH for executables

### Platform-Specific Detection

| Platform | Shells to Detect | Detection Method |
|----------|-----------------|------------------|
| **Windows** | CMD, PowerShell, PowerShell Core, WSL, Git Bash, Cygwin | Registry + File scan |
| **macOS** | bash, zsh, fish, PowerShell Core | `/etc/shells` + File scan |
| **Linux** | bash, zsh, fish, PowerShell Core | `/etc/shells` + File scan |

---

## Recommended Approach for WaveTerm

### 1. Implement Modular Generator Architecture

```typescript
interface ShellDetector {
  readonly id: string;
  readonly displayName: string;
  readonly icon: string;
  detect(): Promise<ShellProfile[]>;
}
```

### 2. Windows Shell Detection Priority

```typescript
// Detection order for Windows
const windowsDetectors: ShellDetector[] = [
  new PowerShellCoreDetector(),    // Check pwsh first (preferred)
  new WindowsPowerShellDetector(), // Fallback to built-in PowerShell
  new CommandPromptDetector(),     // Always available
  new WslDetector(),               // Registry-based
  new GitBashDetector(),           // Registry + file scan
  new SshHostDetector(),           // Config file parsing
];
```

### 3. WSL Detection Implementation

```typescript
// Use Windows Registry via Node.js
import { Registry } from 'winreg';

async function detectWslDistros(): Promise<ShellProfile[]> {
  const key = new Registry({
    hive: Registry.HKCU,
    key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
  });

  // Enumerate subkeys and read DistributionName values
  // Filter out docker-desktop and rancher-desktop prefixes
}
```

### 4. PowerShell Core Detection

```typescript
const pwshPaths = [
  // Traditional installs
  `${process.env.ProgramFiles}\\PowerShell`,
  `${process.env['ProgramFiles(x86)']}\\PowerShell`,

  // Store/MSIX
  `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\pwsh.exe`,

  // Dotnet tools
  `${process.env.USERPROFILE}\\.dotnet\\tools\\pwsh.exe`,

  // Scoop
  `${process.env.USERPROFILE}\\scoop\\shims\\pwsh.exe`,
];
```

### 5. Git Bash Detection

```typescript
const gitBashRegistry = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1',
  'HKLM\\SOFTWARE\\GitForWindows',
];

// Read InstallLocation or InstallPath, append \\bin\\bash.exe
```

### 6. SSH Host Detection

```typescript
const sshConfigPaths = [
  `${process.env.ProgramData}\\ssh\\ssh_config`,
  `${process.env.USERPROFILE}\\.ssh\\config`,
];

// Parse Host and HostName entries
// Generate profile for each host with HostName defined
```

---

## Key Source Files in Windows Terminal

| File | Purpose |
|------|---------|
| `src/cascadia/TerminalSettingsModel/IDynamicProfileGenerator.h` | Generator interface |
| `src/cascadia/TerminalSettingsModel/WslDistroGenerator.cpp` | WSL detection |
| `src/cascadia/TerminalSettingsModel/PowershellCoreProfileGenerator.cpp` | PowerShell detection |
| `src/cascadia/TerminalSettingsModel/SshHostGenerator.cpp` | SSH config parsing |
| `src/cascadia/TerminalSettingsModel/VisualStudioGenerator.cpp` | VS detection |
| `src/cascadia/TerminalSettingsModel/VsSetupConfiguration.cpp` | VS COM API wrapper |
| `src/cascadia/TerminalSettingsModel/CascadiaSettingsSerialization.cpp` | Generator initialization |
| `src/cascadia/TerminalSettingsModel/defaults.json` | Static default profiles |

---

## References

- [Windows Terminal Dynamic Profiles Documentation](https://learn.microsoft.com/en-us/windows/terminal/dynamic-profiles)
- [GitHub: microsoft/terminal](https://github.com/microsoft/terminal)
- [PR #2603: Add Dynamic Profile Generators](https://github.com/microsoft/terminal/pull/2603)
- [PR #10967: Lookup WSL distros in the registry](https://github.com/microsoft/terminal/pull/10967)
- [Issue #1394: Git Bash auto-detection request](https://github.com/microsoft/terminal/issues/1394)
- [Issue #9031: SSH profile generator](https://github.com/microsoft/terminal/issues/9031)
- [Issue #7805: Custom dynamic profile generators](https://github.com/microsoft/terminal/issues/7805)
