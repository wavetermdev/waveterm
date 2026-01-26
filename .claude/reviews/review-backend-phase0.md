# Code Review: Phase 0 Backend - OMP Utilities and IPC Handlers

**Reviewed:** 2026-01-25
**Reviewer:** Code Review Agent (opus/ultrathink)
**Worktree:** G:/Code/worktree-appearance-backend
**Commits:** 821ebfa9..9a3e5cd1

## Overall Decision: NEEDS_FIXES

---

## Security Findings

### CRITICAL: Path Traversal Vulnerability in OmpWritePaletteCommand

**File:** `pkg/wshrpc/wshserver/wshserver.go`
**Confidence:** 85%

**Issue:** The `OmpWritePaletteCommand` handler writes to a file path determined by `wshutil.GetOmpConfigPath()` without performing path traversal validation. While the path comes from environment variables (`$POSH_THEME`) rather than direct user input, an attacker who can control the `POSH_THEME` environment variable could potentially write to arbitrary files.

**Risk Scenario:** If a malicious process sets `POSH_THEME` to a path like `/etc/passwd` or `C:\Windows\System32\config`, the user triggering an OMP palette write could overwrite critical system files.

**Recommendation:** Add path validation using the existing `waveobj.ValidatePath` function or implement similar checks:
1. The path does not contain traversal sequences (`..\\` or `../`)
2. The path is within expected directories (user config directories)
3. The path has expected extensions (.json, .yaml, .toml)

---

### HIGH: Backup File Written with Hardcoded Permissions

**File:** `pkg/wshrpc/wshserver/wshserver.go`
**Confidence:** 82%

**Issue:** The backup file is created with hardcoded `0644` permissions, which may be more permissive than the original file.

**Recommendation:** Preserve the original file's permissions when creating the backup.

---

## Functional Findings

### MergePaletteIntoConfig Only Supports JSON Format

**File:** `pkg/wshutil/omputil.go`
**Confidence:** 90%

**Issue:** The function detects TOML and YAML formats but only implements merging for JSON. This is documented behavior but should be clearly communicated to users.

### OmpGetConfigInfoCommand Swallows os.Stat Error

**File:** `pkg/wshrpc/wshserver/wshserver.go`
**Confidence:** 85%

**Issue:** The `os.Stat` call ignores errors, which could mask filesystem issues.

**Recommendation:** Log or report the error when it occurs.

---

## Required Changes

1. **Add path validation** to `GetOmpConfigPath()` or the RPC handlers
2. **Preserve original file permissions** when creating backup files

## Recommended Changes

1. Add unit tests for `colorutil.go` and `omputil.go`
2. Handle `os.Stat` errors explicitly in `OmpGetConfigInfoCommand`
