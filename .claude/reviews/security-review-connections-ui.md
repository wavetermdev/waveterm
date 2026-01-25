# Security Review: Connections Auto-Detection UI

**Review Date:** 2025-01-25
**Component:** Connections UI with Shell Auto-Detection
**Files Reviewed:**
- `frontend/app/view/waveconfig/connections-content.tsx`
- `frontend/app/view/waveconfig/connections-content.scss`
- `pkg/wshrpc/wshrpctypes.go` (related RPC types)
- `pkg/util/shellutil/shelldetect.go` (backend shell detection)
- `pkg/util/shellutil/shelldetect_windows.go` (Windows shell detection)
- `pkg/wshrpc/wshserver/wshserver.go` (RPC handlers)
- `pkg/wconfig/settingsconfig.go` (config persistence)

---

## Executive Summary

**Overall Risk Assessment: LOW**

The connections auto-detection UI implementation demonstrates generally sound security practices. The React frontend properly leverages React's built-in XSS protection, uses typed RPC calls, and follows established patterns from the existing codebase. The backend shell detection uses safe file system operations with proper timeout controls.

**Key Findings:**
- 0 Critical vulnerabilities
- 1 High severity finding
- 2 Medium severity findings
- 3 Low severity findings

**Determination: CONDITIONAL PASS**

The implementation can proceed with recommended mitigations for the identified findings.

---

## Detailed Findings

### HIGH Severity

#### H-1: Missing Input Validation for Connection Name

**Location:** `frontend/app/view/waveconfig/connections-content.tsx` (lines 1220-1237, 1177-1218)
**Function:** `handleAddConnection`, `handleAddSelectedShells`

**Description:**
The `handleAddConnection` function and `handleAddSelectedShells` function pass user-provided connection names directly to `RpcApi.SetConnectionsConfigCommand` without validation. While the backend `SetConnectionsConfigValue` function in `pkg/wconfig/settingsconfig.go` writes this to a JSON file, there is no validation on:
- Path traversal characters in connection names (e.g., `../../../etc/passwd`)
- Special characters that could cause JSON parsing issues
- Maximum length of connection names
- Reserved or dangerous names

**Code:**
```typescript
const handleAddConnection = useCallback(async (name: string) => {
    // ...
    const data: ConnConfigRequest = {
        host: name,  // No validation on 'name'
        metamaptype: {},
    };
    await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
```

**Impact:** Malicious connection names could potentially:
- Cause configuration file corruption
- Be used for social engineering (displaying misleading names)
- Cause unexpected behavior when the name is used as a key

**Recommendation:**
1. Add frontend validation in `AddConnectionForm` to restrict:
   - Maximum length (e.g., 256 characters)
   - Allowed character set (alphanumeric, `@`, `:`, `.`, `-`, `_`, `/` for WSL paths)
   - Disallow path traversal sequences (`..`, `./`, etc.)
2. Add corresponding backend validation in `SetConnectionsConfigValue`

---

### MEDIUM Severity

#### M-1: Shell Path Not Validated Before Storage

**Location:** `frontend/app/view/waveconfig/connections-content.tsx` (lines 1198-1209)
**Function:** `handleAddSelectedShells`

**Description:**
When adding detected shells, the `shellpath` from the detection result is stored directly in the connection config without validation:

```typescript
const connConfig: ConnKeywords = {};
if (shell.shellpath) {
    connConfig["conn:shellpath"] = shell.shellpath;
}
```

While the shell paths come from the backend `DetectAllShells` function which scans known locations, there's no explicit validation that the stored path:
- Actually exists and is executable
- Contains no dangerous characters
- Is within acceptable system paths

**Impact:** If the shell detection backend is ever compromised or returns malicious data, the path would be stored and potentially executed.

**Recommendation:**
1. Add path validation on the backend before returning detected shells
2. Consider adding a whitelist of acceptable shell paths or directories
3. Validate the path exists and is executable before storing

---

#### M-2: Error Messages May Leak System Information

**Location:** `frontend/app/view/waveconfig/connections-content.tsx` (lines 1137, 1213-1214, 1233, 1250, 1294)

**Description:**
Error messages from RPC calls are displayed directly to the user:

```typescript
setDetectionError(`Detection failed: ${err.message || String(err)}`);
setError(`Failed to add shells: ${err.message || String(err)}`);
setError(`Failed to add connection: ${err.message || String(err)}`);
```

**Impact:** Backend error messages may contain:
- System paths
- Internal error codes
- Stack traces
- Configuration details

This information could aid an attacker in understanding the system.

**Recommendation:**
1. Sanitize error messages before display
2. Log detailed errors for debugging but show generic user-friendly messages
3. Implement error categorization (user error vs. system error)

---

### LOW Severity

#### L-1: No Rate Limiting on Shell Detection

**Location:** `frontend/app/view/waveconfig/connections-content.tsx` (line 1111)
**Function:** `handleAutoDetect`

**Description:**
The `handleAutoDetect` function can be called repeatedly without any rate limiting. Each call triggers backend shell detection which includes:
- File system scans
- WSL distro enumeration
- Version detection subprocess execution

**Impact:** A user (or automated script) could repeatedly trigger detection, causing:
- Increased CPU usage
- File system stress
- Resource exhaustion

**Mitigation:** The backend does have a 5-minute cache (`shellDetectCacheTTL`) which provides some protection, but the `rescan` parameter bypasses this cache.

**Recommendation:**
1. Add frontend debouncing/throttling on the detection button
2. Consider adding rate limiting on the backend `DetectAvailableShellsCommand`

---

#### L-2: Delete Confirmation Can Be Bypassed Programmatically

**Location:** `frontend/app/view/waveconfig/connections-content.tsx` (lines 959-967)

**Description:**
The delete confirmation dialog is purely UI-based. The actual deletion logic in `handleDeleteConnection` directly reads and modifies the connections file:

```typescript
const handleDeleteConnection = useCallback(async () => {
    // Direct file manipulation without additional verification
    const fileData = await RpcApi.FileReadCommand(TabRpcClient, {...});
    delete connectionsData[selectedConnection];
    await RpcApi.FileWriteCommand(TabRpcClient, {...});
```

**Impact:** If the UI is bypassed (e.g., via browser console), connections can be deleted without confirmation.

**Note:** This is a low severity finding as it requires local access and the user is already authenticated.

**Recommendation:**
Consider moving delete confirmation to the backend or adding a confirmation token.

---

#### L-3: Base64 Encoding Without Explicit Content-Type

**Location:** `frontend/app/view/waveconfig/connections-content.tsx` (lines 1271, 1286-1290)

**Description:**
When reading and writing the connections file, content is base64 encoded/decoded:

```typescript
const content = atob(fileData.data64);
const encoded = btoa(JSON.stringify(connectionsData, null, 2));
```

The `atob`/`btoa` functions use Latin1 encoding by default, which could cause issues with non-ASCII characters in connection configurations.

**Impact:** Configuration data with non-ASCII characters (e.g., international usernames) could be corrupted.

**Recommendation:**
Use explicit UTF-8 encoding/decoding:
```typescript
const content = new TextDecoder().decode(Uint8Array.from(atob(fileData.data64), c => c.charCodeAt(0)));
const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(connectionsData, null, 2))));
```

---

## Security Controls Verified

### XSS Protection - PASS

The React implementation provides inherent XSS protection:
- All user data is rendered through JSX which auto-escapes content
- No use of innerHTML or similar unsafe DOM manipulation patterns
- No direct DOM manipulation with user data
- CSS class names use the `cn()` utility (classnames) which sanitizes input

**Evidence:**
```typescript
<span className="connections-list-item-name">{connection.name}</span>
<span className="connections-detect-item-version">{shell.version}</span>
```

### RPC Call Security - PASS

All RPC calls use the typed `RpcApi` interface:
- `RpcApi.DetectAvailableShellsCommand` - Uses typed `DetectShellsRequest`
- `RpcApi.SetConnectionsConfigCommand` - Uses typed `ConnConfigRequest`
- `RpcApi.FileReadCommand` / `RpcApi.FileWriteCommand` - Uses typed `FileInfo`

The RPC system uses WebSocket over authenticated channels with JWT tokens.

### State Management Security - PASS

State management uses Jotai atoms with proper encapsulation:
- No direct state mutation (uses `useState` setters correctly)
- Immutable state updates (`{ ...prev }` patterns)
- No sensitive data stored in client-side state

### Input Handling - PARTIAL PASS

- Form inputs properly controlled via React state
- Keyboard event handling for Enter/Escape is safe
- **Missing:** Server-side validation of connection names (see H-1)

### Authentication - PASS

- RPC calls go through authenticated `TabRpcClient`
- File operations restricted to config directory
- No credentials stored in component state

### Backend Shell Detection - PASS

The backend shell detection in `shelldetect_windows.go` is secure:
- Uses `filepath.Join` for path construction
- Uses environment variables (`SystemRoot`, `ProgramFiles`) safely
- WSL distro enumeration uses context with timeout (5 seconds)
- Filters out dangerous/utility distros (docker-desktop, etc.)
- Uses `os.Stat` / `fileExists` checks before adding shells

---

## OWASP Top 10 Assessment

| Category | Status | Notes |
|----------|--------|-------|
| A01:2021 Broken Access Control | PASS | RPC calls use authenticated channels |
| A02:2021 Cryptographic Failures | N/A | No cryptographic operations in this component |
| A03:2021 Injection | PARTIAL | Missing input validation (H-1) |
| A04:2021 Insecure Design | PASS | Follows established patterns |
| A05:2021 Security Misconfiguration | PASS | No hardcoded secrets or debug code |
| A06:2021 Vulnerable Components | PASS | Uses typed React/Jotai patterns |
| A07:2021 Auth Failures | PASS | Uses existing auth system |
| A08:2021 Data Integrity Failures | PARTIAL | No signature on config files |
| A09:2021 Security Logging | N/A | Logging handled by backend |
| A10:2021 Server-Side Request Forgery | N/A | No external requests in this component |

---

## Recommendations Summary

### Priority 1 (Before Production)
- [ ] Add connection name validation (H-1)
- [ ] Add shell path validation (M-1)

### Priority 2 (Short Term)
- [ ] Sanitize error messages (M-2)
- [ ] Add rate limiting on detection (L-1)

### Priority 3 (Long Term)
- [ ] Fix base64 encoding for UTF-8 (L-3)
- [ ] Consider backend-side delete confirmation (L-2)

---

## Conclusion

The connections auto-detection UI is a well-implemented feature that follows React and TypeScript best practices. The primary security concern is the lack of input validation for connection names before they are persisted. With the recommended mitigations applied, this implementation meets security requirements for production use.

**Reviewers:**
- Security Review Agent (Claude Opus 4.5)

**Review Status:** CONDITIONAL PASS - Requires input validation before production deployment.
