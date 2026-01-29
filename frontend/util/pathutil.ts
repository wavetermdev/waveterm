// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Path validation utilities for sanitizing untrusted paths from terminal output.
 * Provides defense against path traversal, injection, and other security attacks.
 *
 * Security checks performed:
 * - Null byte detection (prevents path truncation attacks)
 * - Path traversal pattern detection (../ sequences)
 * - UNC path blocking on Windows (prevents network data exfiltration)
 * - Windows device name blocking (CON, NUL, AUX, etc.)
 * - Length limit enforcement (prevents DoS via long paths)
 * - Blocked sensitive directory detection
 */

import { PLATFORM, PlatformWindows } from "@/util/platformutil";

// Maximum allowed path length (prevent DoS via extremely long paths)
const MAX_PATH_LENGTH = 4096;

// Windows device names (special files that can cause issues)
const WINDOWS_DEVICE_NAMES = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
];

// Blocked directory patterns by platform
const BLOCKED_PATHS_UNIX = [
    "/etc",
    "/root",
    "/var/log",
    "/boot",
    "/sys",
    "/proc",
    "/dev",
    "/private/etc", // macOS
    "/private/var", // macOS
    "/System", // macOS
    "/Library/System",
];

const BLOCKED_PATHS_WINDOWS = [
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\SysWOW64",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\Recovery",
    "C:\\$Recycle.Bin",
];

/**
 * Checks if a string contains null bytes (injection attack).
 */
export function hasNullBytes(str: string): boolean {
    return str.includes("\0");
}

/**
 * Checks if a path contains path traversal sequences.
 * Detects both Unix (..) and Windows-style traversal patterns.
 */
export function containsPathTraversal(path: string): boolean {
    // Check for .. sequences in various forms
    // Unix: ../ or /..
    // Windows: ..\ or \..
    // Exact match: just ".."
    // Trailing: ends with ".."

    // Pattern: .. followed by / or \
    if (/\.\.[\/\\]/.test(path)) {
        return true;
    }

    // Pattern: / or \ followed by ..
    if (/[\/\\]\.\./.test(path)) {
        return true;
    }

    // Pattern: exactly ".."
    if (path === "..") {
        return true;
    }

    // Pattern: ends with ".." (Windows trailing dots attack vector)
    if (path.endsWith("..")) {
        return true;
    }

    return false;
}

/**
 * Checks if a path is a UNC path (Windows network path).
 * UNC paths start with \\ and can be used for data exfiltration.
 */
export function isUncPath(path: string): boolean {
    // Standard UNC: \\server\share
    if (path.startsWith("\\\\")) {
        return true;
    }

    // URL-style UNC that might slip through: //server/share
    // (if it starts with // followed by non-slash)
    if (/^\/\/[^\/]/.test(path)) {
        return true;
    }

    // UNC path that was prefixed with / (from URL parsing)
    if (path.startsWith("/\\\\")) {
        return true;
    }

    return false;
}

/**
 * Checks if a path contains invalid characters for the platform.
 * On Windows, checks for reserved characters.
 */
export function hasInvalidChars(path: string, platform: string): boolean {
    if (platform === PlatformWindows) {
        // Windows reserved characters (except \ and / which are path separators)
        // < > : " | ? * and control characters
        // Note: : is allowed as second char for drive letter
        const pathWithoutDrive = path.length >= 2 && path[1] === ":" ? path.substring(2) : path;
        if (/[<>"|?*]/.test(pathWithoutDrive)) {
            return true;
        }
        // Control characters (0x00-0x1F)
        if (/[\x00-\x1F]/.test(path)) {
            return true;
        }
    }
    return false;
}

/**
 * Checks if a path matches a Windows device name.
 * Device names like CON, NUL, AUX can cause issues.
 */
function isWindowsDeviceName(path: string): boolean {
    // Get just the filename/last component
    const parts = path.split(/[\/\\]/);
    const filename = parts[parts.length - 1] || path;

    // Extract name without extension
    const nameWithoutExt = filename.split(".")[0].toUpperCase();

    return WINDOWS_DEVICE_NAMES.includes(nameWithoutExt);
}

/**
 * Checks if a normalized path starts with or equals a blocked path.
 */
export function isBlockedPath(normalizedPath: string): boolean {
    const blockedPaths = PLATFORM === PlatformWindows ? BLOCKED_PATHS_WINDOWS : BLOCKED_PATHS_UNIX;

    // Normalize separators to forward slashes for consistent comparison on Windows
    // This ensures C:/Windows matches against C:\Windows in the blocked list
    const normalizedForComparison =
        PLATFORM === PlatformWindows ? normalizedPath.replace(/\\/g, "/") : normalizedPath;
    const lowerPath = normalizedForComparison.toLowerCase();

    for (const blocked of blockedPaths) {
        // Also normalize blocked paths to forward slashes on Windows
        const normalizedBlocked = PLATFORM === PlatformWindows ? blocked.replace(/\\/g, "/") : blocked;
        const lowerBlocked = normalizedBlocked.toLowerCase();
        // Check exact match or path starts with blocked + separator
        if (lowerPath === lowerBlocked || lowerPath.startsWith(lowerBlocked + "/")) {
            return true;
        }
    }

    return false;
}

export type PathValidationResult = {
    valid: boolean;
    reason?: string;
};

/**
 * Performs quick synchronous validation of a path without filesystem access.
 * This is the first line of defense against obviously malicious paths.
 *
 * @param rawPath - The untrusted path to validate
 * @returns Validation result with valid flag and optional reason for rejection
 */
export function quickValidatePath(rawPath: string): PathValidationResult {
    // Allow empty/whitespace paths - they represent "no path" or "clear"
    // This enables OSC 7 to clear tab:basedir by sending an empty path
    // The caller can decide how to handle empty paths
    if (!rawPath || rawPath.trim() === "") {
        return { valid: true };
    }

    // Check length limit
    if (rawPath.length > MAX_PATH_LENGTH) {
        return { valid: false, reason: "path too long" };
    }

    // Check for null bytes (path truncation attack)
    if (hasNullBytes(rawPath)) {
        return { valid: false, reason: "null byte detected" };
    }

    // Check for path traversal patterns
    if (containsPathTraversal(rawPath)) {
        return { valid: false, reason: "path traversal detected" };
    }

    // Check for UNC paths (Windows network paths - security risk)
    if (isUncPath(rawPath)) {
        return { valid: false, reason: "UNC path detected" };
    }

    // Check for Windows device names
    if (PLATFORM === PlatformWindows) {
        if (isWindowsDeviceName(rawPath)) {
            return { valid: false, reason: "Windows device name" };
        }

        // Check for invalid characters on Windows
        if (hasInvalidChars(rawPath, PlatformWindows)) {
            return { valid: false, reason: "invalid characters" };
        }
    }

    return { valid: true };
}

/**
 * Sanitizes a path from OSC 7 terminal escape sequence.
 * Returns the validated path or null if the path should be rejected.
 *
 * This function performs:
 * 1. Quick synchronous validation (pattern-based)
 * 2. Blocked path checking
 *
 * Note: Filesystem-based validation (symlink resolution, existence check)
 * is handled separately via IPC to the main process.
 *
 * @param rawPath - The untrusted path from terminal output (already URL-decoded)
 * @returns Validated path string or null if rejected
 */
export function sanitizeOsc7Path(rawPath: string): string | null {
    // Quick synchronous checks first
    const quickResult = quickValidatePath(rawPath);
    if (!quickResult.valid) {
        console.warn(`[Security] OSC 7 path rejected (${quickResult.reason}):`, rawPath);
        return null;
    }

    // Normalize the path for blocked path checking
    // Note: We don't resolve symlinks here - that requires filesystem access
    let normalizedPath = rawPath;

    // Check against blocked paths
    if (isBlockedPath(normalizedPath)) {
        console.warn("[Security] OSC 7 blocked path rejected:", normalizedPath);
        return null;
    }

    // Path passed all synchronous checks
    // Non-existent paths are allowed per spec-005 - they will be warned about
    // when used, but not rejected here
    return normalizedPath;
}
