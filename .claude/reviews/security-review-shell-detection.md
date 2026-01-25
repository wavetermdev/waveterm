# Security Review: Shell Detection Implementation

**Review Date:** 2025-01-25
**Reviewer:** Security Audit (Automated)
**Files Reviewed:**
- `pkg/util/shellutil/shelldetect.go`
- `pkg/util/shellutil/shelldetect_windows.go`
- `pkg/util/shellutil/shelldetect_unix.go`
- `pkg/wshrpc/wshserver/wshserver.go` (DetectAvailableShellsCommand)
- `pkg/util/shellutil/shellutil.go` (supporting functions)

**Overall Assessment:** PASS (with recommendations)

---

## Executive Summary

The shell detection implementation follows generally sound security practices. The code primarily performs read-only operations (filesystem checks, registry lookups, environment variable reads) and does not directly execute arbitrary user input. However, there are several areas where security could be hardened.

**Risk Level:** LOW to MEDIUM

The most significant risks relate to:
1. Environment variable manipulation affecting path construction
2. Limited validation of detected shell paths before they are cached and potentially executed downstream
3. Information disclosure through verbose logging

---

## Detailed Findings

### MEDIUM: Environment Variable Injection in Path Construction

**Severity:** Medium
**CVSS Score:** 5.3 (Medium)
**Location:** `pkg/util/shellutil/shelldetect_windows.go`, lines 59-64, 82-87, 141-145, 172-184

**Description:**
Shell detection relies heavily on environment variables (`SystemRoot`, `ProgramFiles`, `LOCALAPPDATA`, `USERPROFILE`) without validation. An attacker with the ability to modify environment variables could potentially redirect path lookups to malicious locations.

**Code Example:**
```go
systemRoot := os.Getenv("SystemRoot")
if systemRoot == "" {
    systemRoot = `C:\Windows`
}
cmdPath := filepath.Join(systemRoot, "System32", "cmd.exe")
```

**Impact:**
- If an attacker can modify environment variables before Wave Terminal starts, they could cause the application to detect and potentially use a malicious shell binary.
- This is a pre-requisite attack (attacker must already have local access to modify environment), limiting real-world exploitability.

**Recommendation:**
1. Validate that `SystemRoot` points to an expected Windows installation directory
2. Verify detected paths are within expected system directories
3. Check digital signatures of shell executables on Windows

---

### MEDIUM: Unvalidated Shell Paths Returned via RPC

**Severity:** Medium
**CVSS Score:** 4.7 (Medium)
**Location:** `pkg/wshrpc/wshserver/wshserver.go`, lines 829-859

**Description:**
The `DetectAvailableShellsCommand` RPC handler returns shell paths directly without sanitization or validation. While the paths are generated internally, this could be a concern if the detection logic is compromised or if downstream consumers trust these paths implicitly.

**Code Example:**
```go
func (ws *WshServer) DetectAvailableShellsCommand(ctx context.Context, data wshrpc.DetectShellsRequest) (wshrpc.DetectShellsResponse, error) {
    // ...
    detectedShells, err := shellutil.DetectAllShells(&fullConfig, data.Rescan)
    // Paths are returned without additional validation
    for i, shell := range detectedShells {
        rpcShells[i] = wshrpc.DetectedShell{
            ShellPath: shell.ShellPath,  // No path validation here
            // ...
        }
    }
}
```

**Impact:**
- A compromised detection mechanism could return malicious paths
- Path traversal in shell paths could potentially be exploited

**Positive Finding:**
The codebase does have `ValidatePath()` in `pkg/waveobj/validators.go` which validates paths stored in metadata (including `MetaKey_TermLocalShellPath`). This validation includes:
- Length checks (DoS protection)
- Null byte checks
- Path traversal detection
- Existence verification (with warnings)

**Recommendation:**
1. Apply similar validation to detected shell paths before caching
2. Verify that shell paths are absolute paths
3. On Windows, verify paths don't contain suspicious patterns

---

### LOW: Information Disclosure via Debug Logging

**Severity:** Low
**CVSS Score:** 3.1 (Low)
**Location:** Multiple locations in detection files

**Description:**
Debug logging reveals filesystem structure and installed software details.

**Code Examples:**
```go
log.Printf("debug: cmd.exe not found at %s", cmdPath)
log.Printf("debug: Windows PowerShell not found at %s", psPath)
log.Printf("debug: error getting WSL distros: %v", err)
```

**Impact:**
- Logs may reveal system configuration details useful for reconnaissance
- Error messages could leak path information

**Recommendation:**
1. Ensure debug logging is disabled in production builds
2. Consider using structured logging with configurable levels
3. Avoid logging full paths in error messages

---

### LOW: Race Condition Window in Caching Mechanism

**Severity:** Low
**CVSS Score:** 2.4 (Low)
**Location:** `pkg/util/shellutil/shelldetect.go`, lines 64-93 and `pkg/utilds/synccache.go`

**Description:**
The shell detection cache uses proper mutex locking (`shellDetectCacheLock` and `sync.Mutex` in SyncCache). However, there is a TOCTOU (Time-of-Check-Time-of-Use) window between when a shell is detected and when it is executed.

**Positive Finding:**
The caching implementation is thread-safe:
```go
shellDetectCacheLock.Lock()
defer shellDetectCacheLock.Unlock()
// Cache operations are protected
```

**Residual Risk:**
- A shell binary could be replaced between detection and execution
- This is a general filesystem security concern, not specific to this implementation

**Recommendation:**
1. Consider re-verifying shell existence immediately before execution
2. On Windows, verify digital signatures of executables before execution
3. Document this as an accepted risk given the nature of shell execution

---

### LOW: WSL Distro Name Handling

**Severity:** Low
**CVSS Score:** 2.0 (Low)
**Location:** `pkg/util/shellutil/shelldetect_windows.go`, lines 206-259

**Description:**
WSL distro names are obtained from the Windows API via the `gowsl` library and used to construct shell paths and identifiers.

**Code Example:**
```go
shellPath := fmt.Sprintf("wsl://%s", distroName)
```

**Positive Findings:**
1. Distro names come from the trusted Windows WSL API (not user input)
2. Invalid/utility distros are filtered out (`isInvalidWslDistro`)
3. The `wsl://` prefix format prevents direct command injection

**Recommendation:**
1. Consider additional sanitization of distro names (remove special characters)
2. Verify distro names don't contain path traversal sequences

---

### INFO: Unix /etc/shells Parsing

**Severity:** Informational
**Location:** `pkg/util/shellutil/shelldetect_unix.go`, lines 42-82

**Description:**
The `/etc/shells` file is parsed securely with proper handling.

**Positive Findings:**
1. Comments and empty lines are properly skipped
2. Each shell path is verified to exist before being added
3. Unknown shell types are filtered out
4. No command execution based on file contents

**Code Example:**
```go
for scanner.Scan() {
    line := strings.TrimSpace(scanner.Text())
    if line == "" || strings.HasPrefix(line, "#") {
        continue
    }
    if !fileExists(line) {
        continue
    }
    // ... additional validation
}
```

---

### INFO: Command Injection Prevention in Version Detection

**Severity:** Informational
**Location:** `pkg/util/shellutil/shellutil.go`, lines 510-540

**Description:**
Shell version detection executes detected shell binaries with `--version` flag.

**Positive Findings:**
1. Shell paths are not user-controlled but derived from detection
2. The `--version` flag is hardcoded, not constructed from user input
3. Command execution uses proper argument separation (not shell interpolation)

**Code Example:**
```go
cmd = exec.CommandContext(ctx, shellPath, "--version")
```

This uses Go's `exec.Command` which passes arguments directly without shell interpretation.

---

### INFO: macOS User Shell Detection Security

**Severity:** Informational
**Location:** `pkg/util/shellutil/shellutil.go`, lines 120-138

**Description:**
The macOS user shell is detected by running `dscl` command with the current username.

**Positive Findings:**
1. Username is obtained from the OS (`user.Current()`), not user input
2. Command has a 2-second timeout preventing hangs
3. Output is validated against a regex pattern before use

**Code Example:**
```go
osUser, err := user.Current()
// ...
userStr := "/Users/" + osUser.Username
out, err := exec.CommandContext(ctx, "dscl", ".", "-read", userStr, "UserShell").CombinedOutput()
```

**Note:** The username comes from the authenticated OS user, limiting injection risk.

---

## Security Requirements Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| All inputs validated and sanitized | PARTIAL | External inputs are limited; internal paths could use more validation |
| No hardcoded secrets or credentials | PASS | No secrets in detection code |
| Proper authentication on all endpoints | N/A | Detection is local-only currently |
| SQL queries use parameterization | N/A | No SQL in this code |
| XSS protection implemented | N/A | Backend code only |
| HTTPS enforced where needed | N/A | Local operations only |
| CSRF protection enabled | N/A | RPC-based API |
| Security headers properly configured | N/A | Not applicable |
| Error messages don't leak sensitive information | PARTIAL | Debug logs reveal paths |
| Dependencies are up-to-date | REVIEW | gowsl library should be audited |

---

## Risk Matrix

| Finding | Severity | Likelihood | Impact | Risk Score |
|---------|----------|------------|--------|------------|
| Environment Variable Injection | Medium | Low | Medium | MEDIUM |
| Unvalidated RPC Shell Paths | Medium | Low | Medium | MEDIUM |
| Debug Information Disclosure | Low | Medium | Low | LOW |
| TOCTOU Race Condition | Low | Low | Medium | LOW |
| WSL Distro Name Handling | Low | Very Low | Low | LOW |

---

## Remediation Roadmap

### Priority 1 (Within 30 days)
1. **Add path validation to detected shells** - Implement `ValidatePath()`-style checks on detected shell paths before caching
2. **Validate environment variable paths** - Check that system directories point to expected locations

### Priority 2 (Within 60 days)
3. **Review logging levels** - Ensure debug logs are not present in production builds
4. **Audit gowsl dependency** - Review the third-party WSL library for security issues

### Priority 3 (Within 90 days)
5. **Consider executable signature verification** - On Windows, verify shell executables are signed
6. **Document accepted risks** - Create security documentation noting TOCTOU and environmental risks

---

## Conclusion

The shell detection implementation demonstrates reasonable security practices for its purpose. The code:
- Does not execute arbitrary user input
- Uses proper argument handling in command execution
- Implements thread-safe caching
- Filters invalid/utility entries from results

The identified risks are primarily related to environmental manipulation requiring pre-existing local access, which represents a low-probability attack scenario. The existing `ValidatePath()` validator in the codebase provides a template for additional path validation that could be applied to detection results.

**Final Determination:** PASS

The implementation is suitable for production use with the recommended improvements to further harden security.
