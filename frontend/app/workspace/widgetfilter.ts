// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

function shouldIncludeWidgetForWorkspace(widget: WidgetConfigType, workspaceId?: string): boolean {
    const workspaces = widget.workspaces;
    return !Array.isArray(workspaces) || workspaces.length === 0 || (workspaceId != null && workspaces.includes(workspaceId));
}

export { shouldIncludeWidgetForWorkspace };
