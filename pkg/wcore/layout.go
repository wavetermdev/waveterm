// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	LayoutActionDataType_Insert          = "insert"
	LayoutActionDataType_InsertAtIndex   = "insertatindex"
	LayoutActionDataType_Remove          = "delete"
	LayoutActionDataType_ClearTree       = "clear"
	LayoutActionDataType_Replace         = "replace"
	LayoutActionDataType_SplitHorizontal = "splithorizontal"
	LayoutActionDataType_SplitVertical   = "splitvertical"
	LayoutActionDataType_CleanupOrphaned = "cleanuporphaned"
	LayoutActionDataType_SetRoot         = "setroot"
)

type PortableLayout = waveobj.PortableLayout

func GetStarterLayout() PortableLayout {
	return PortableLayout{
		{IndexArr: []int{0}, BlockDef: &waveobj.BlockDef{
			Meta: waveobj.MetaMapType{
				waveobj.MetaKey_View:       "term",
				waveobj.MetaKey_Controller: "shell",
			},
		}, Focused: true},
		{IndexArr: []int{1}, BlockDef: &waveobj.BlockDef{
			Meta: waveobj.MetaMapType{
				waveobj.MetaKey_View: "sysinfo",
			},
		}},
		{IndexArr: []int{1, 1}, BlockDef: &waveobj.BlockDef{
			Meta: waveobj.MetaMapType{
				waveobj.MetaKey_View: "web",
				waveobj.MetaKey_Url:  "https://github.com/wavetermdev/waveterm",
			},
		}},
		{IndexArr: []int{1, 2}, BlockDef: &waveobj.BlockDef{
			Meta: waveobj.MetaMapType{
				waveobj.MetaKey_View: "preview",
				waveobj.MetaKey_File: "~",
			},
		}},
	}
}

// CaptureTabAsPortableLayout captures a tab's current layout and block configuration as a portable layout
func CaptureTabAsPortableLayout(ctx context.Context, tabId string) (PortableLayout, error) {
	// 1. Get the tab
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab %s: %w", tabId, err)
	}
	if tab == nil {
		return nil, fmt.Errorf("tab not found: %s", tabId)
	}

	// 2. Get the LayoutState
	layoutState, err := wstore.DBGet[*waveobj.LayoutState](ctx, tab.LayoutState)
	if err != nil {
		return nil, fmt.Errorf("error getting layout state %s: %w", tab.LayoutState, err)
	}
	if layoutState == nil {
		return nil, fmt.Errorf("layout state not found: %s", tab.LayoutState)
	}

	// 3. Walk the tree and capture layout entries
	var result PortableLayout
	if layoutState.RootNode != nil {
		err = walkLayoutTree(ctx, layoutState.RootNode, []int{}, layoutState.FocusedNodeId, &result)
		if err != nil {
			return nil, fmt.Errorf("error walking layout tree: %w", err)
		}
	}

	return result, nil
}

// walkLayoutTree recursively walks the layout tree and captures block information
func walkLayoutTree(ctx context.Context, node any, indexArr []int, focusedNodeId string, result *PortableLayout) error {
	if node == nil {
		return nil
	}

	nodeMap, ok := node.(map[string]any)
	if !ok {
		return nil
	}

	// Check if this is a leaf node (has data with blockId)
	if data, hasData := nodeMap["data"]; hasData {
		dataMap, ok := data.(map[string]any)
		if ok {
			if blockId, hasBlockId := dataMap["blockId"]; hasBlockId {
				blockIdStr, ok := blockId.(string)
				if ok && blockIdStr != "" {
					// This is a leaf node - capture it
					block, err := wstore.DBGet[*waveobj.Block](ctx, blockIdStr)
					if err != nil {
						return fmt.Errorf("error getting block %s: %w", blockIdStr, err)
					}
					if block != nil {
						entry := waveobj.PortableLayoutEntry{
							IndexArr: append([]int{}, indexArr...), // copy the slice
							BlockDef: &waveobj.BlockDef{
								Meta: block.Meta,
							},
						}

						// Check if this node is focused
						if nodeId, hasNodeId := nodeMap["id"]; hasNodeId {
							if nodeIdStr, ok := nodeId.(string); ok && nodeIdStr == focusedNodeId {
								entry.Focused = true
							}
						}

						// Capture size if present and non-zero
						if size, hasSize := nodeMap["size"]; hasSize {
							if sizeFloat, ok := size.(float64); ok && sizeFloat > 0 {
								sizeUint := uint(sizeFloat)
								entry.Size = &sizeUint
							}
						}

						*result = append(*result, entry)
					}
				}
			}
		}
		return nil
	}

	// Check for children (this is a branch node)
	if children, hasChildren := nodeMap["children"]; hasChildren {
		childrenSlice, ok := children.([]any)
		if ok {
			for i, child := range childrenSlice {
				childIndexArr := append([]int{}, indexArr...)
				childIndexArr = append(childIndexArr, i)
				err := walkLayoutTree(ctx, child, childIndexArr, focusedNodeId, result)
				if err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// captureLayoutNode recursively captures a layout tree node, replacing blockIds with BlockDefs.
func captureLayoutNode(ctx context.Context, node map[string]any, focusedNodeId string) (*waveobj.PortableLayoutNode, error) {
	if node == nil {
		return nil, nil
	}
	pNode := &waveobj.PortableLayoutNode{}
	if fd, ok := node["flexdirection"].(string); ok {
		pNode.FlexDirection = fd
	}
	if size, ok := node["size"].(float64); ok && size > 0 {
		pNode.Size = size
	}
	if id, ok := node["id"].(string); ok && id == focusedNodeId {
		pNode.Focused = true
	}
	// Leaf node
	if data, ok := node["data"].(map[string]any); ok {
		if blockId, ok := data["blockId"].(string); ok && blockId != "" {
			block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
			if err != nil {
				return nil, fmt.Errorf("error getting block %s: %w", blockId, err)
			}
			if block != nil {
				pNode.BlockDef = &waveobj.BlockDef{Meta: block.Meta}
			}
		}
		return pNode, nil
	}
	// Branch node
	if children, ok := node["children"].([]any); ok {
		for _, child := range children {
			childMap, ok := child.(map[string]any)
			if !ok {
				continue
			}
			childNode, err := captureLayoutNode(ctx, childMap, focusedNodeId)
			if err != nil {
				return nil, err
			}
			if childNode != nil {
				pNode.Children = append(pNode.Children, childNode)
			}
		}
	}
	return pNode, nil
}

// CaptureTabAsLayoutTree captures a tab's layout as a full tree preserving all branch flexDirections.
func CaptureTabAsLayoutTree(ctx context.Context, tabId string) (*waveobj.PortableLayoutNode, error) {
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab %s: %w", tabId, err)
	}
	if tab == nil {
		return nil, fmt.Errorf("tab not found: %s", tabId)
	}
	layoutState, err := wstore.DBGet[*waveobj.LayoutState](ctx, tab.LayoutState)
	if err != nil {
		return nil, fmt.Errorf("error getting layout state %s: %w", tab.LayoutState, err)
	}
	if layoutState == nil {
		return nil, fmt.Errorf("layout state not found: %s", tab.LayoutState)
	}
	if layoutState.RootNode == nil {
		return nil, nil
	}
	rootMap, ok := layoutState.RootNode.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unexpected root node type: %T", layoutState.RootNode)
	}
	return captureLayoutNode(ctx, rootMap, layoutState.FocusedNodeId)
}

// realizeLayoutNode creates blocks for each leaf and returns a JSON-ready tree for the frontend.
func realizeLayoutNode(ctx context.Context, tabId string, node *waveobj.PortableLayoutNode, focusedBlockId *string, recordTelemetry bool) (map[string]any, error) {
	if node == nil {
		return nil, nil
	}
	result := map[string]any{
		"flexdirection": node.FlexDirection,
	}
	if node.Size > 0 {
		result["size"] = node.Size
	}
	if node.BlockDef != nil {
		blockData, err := CreateBlockWithTelemetry(ctx, tabId, node.BlockDef, &waveobj.RuntimeOpts{}, recordTelemetry)
		if err != nil {
			return nil, fmt.Errorf("error creating block: %w", err)
		}
		result["data"] = map[string]any{"blockId": blockData.OID}
		if node.Focused {
			*focusedBlockId = blockData.OID
		}
		return result, nil
	}
	if len(node.Children) > 0 {
		children := make([]any, 0, len(node.Children))
		for _, child := range node.Children {
			childResult, err := realizeLayoutNode(ctx, tabId, child, focusedBlockId, recordTelemetry)
			if err != nil {
				return nil, err
			}
			if childResult != nil {
				children = append(children, childResult)
			}
		}
		result["children"] = children
	}
	return result, nil
}

// ApplyLayoutTree applies a full layout tree to a tab, preserving all branch flexDirections.
func ApplyLayoutTree(ctx context.Context, tabId string, root *waveobj.PortableLayoutNode, recordTelemetry bool) error {
	if root == nil {
		return nil
	}
	var focusedBlockId string
	realizedRoot, err := realizeLayoutNode(ctx, tabId, root, &focusedBlockId, recordTelemetry)
	if err != nil {
		return fmt.Errorf("error realizing layout tree: %w", err)
	}
	actions := []waveobj.LayoutActionData{
		{ActionType: LayoutActionDataType_ClearTree},
		{ActionType: LayoutActionDataType_SetRoot, RootNode: realizedRoot, BlockId: focusedBlockId},
	}
	return QueueLayoutActionForTab(ctx, tabId, actions...)
}

func GetNewTabLayout() PortableLayout {
	return PortableLayout{
		{IndexArr: []int{0}, BlockDef: &waveobj.BlockDef{
			Meta: waveobj.MetaMapType{
				waveobj.MetaKey_View:       "term",
				waveobj.MetaKey_Controller: "shell",
			},
		}, Focused: true},
	}
}

func GetLayoutIdForTab(ctx context.Context, tabId string) (string, error) {
	tabObj, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("unable to get layout id for given tab id %s: %w", tabId, err)
	}
	return tabObj.LayoutState, nil
}

func QueueLayoutAction(ctx context.Context, layoutStateId string, actions ...waveobj.LayoutActionData) error {
	layoutStateObj, err := wstore.DBGet[*waveobj.LayoutState](ctx, layoutStateId)
	if err != nil {
		return fmt.Errorf("unable to get layout state for given id %s: %w", layoutStateId, err)
	}

	for i := range actions {
		if actions[i].ActionId == "" {
			actions[i].ActionId = uuid.New().String()
		}
	}

	if layoutStateObj.PendingBackendActions == nil {
		layoutStateObj.PendingBackendActions = &actions
	} else {
		*layoutStateObj.PendingBackendActions = append(*layoutStateObj.PendingBackendActions, actions...)
	}

	err = wstore.DBUpdate(ctx, layoutStateObj)
	if err != nil {
		return fmt.Errorf("unable to update layout state with new actions: %w", err)
	}
	return nil
}

func QueueLayoutActionForTab(ctx context.Context, tabId string, actions ...waveobj.LayoutActionData) error {
	layoutStateId, err := GetLayoutIdForTab(ctx, tabId)
	if err != nil {
		return err
	}

	return QueueLayoutAction(ctx, layoutStateId, actions...)
}

func ApplyPortableLayout(ctx context.Context, tabId string, layout PortableLayout, recordTelemetry bool) error {
	actions := make([]waveobj.LayoutActionData, len(layout)+1)
	actions[0] = waveobj.LayoutActionData{ActionType: LayoutActionDataType_ClearTree}
	for i := 0; i < len(layout); i++ {
		layoutAction := layout[i]

		blockData, err := CreateBlockWithTelemetry(ctx, tabId, layoutAction.BlockDef, &waveobj.RuntimeOpts{}, recordTelemetry)
		if err != nil {
			return fmt.Errorf("unable to create block to apply portable layout to tab %s: %w", tabId, err)
		}

		actions[i+1] = waveobj.LayoutActionData{
			ActionType: LayoutActionDataType_InsertAtIndex,
			BlockId:    blockData.OID,
			IndexArr:   &layoutAction.IndexArr,
			NodeSize:   layoutAction.Size,
			Focused:    layoutAction.Focused,
		}
	}

	err := QueueLayoutActionForTab(ctx, tabId, actions...)
	if err != nil {
		return fmt.Errorf("unable to queue layout actions for portable layout: %w", err)
	}

	return nil
}

func BootstrapStarterLayout(ctx context.Context) error {
	ctx, cancelFn := context.WithTimeout(ctx, 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		log.Printf("unable to find client: %v\n", err)
		return fmt.Errorf("unable to find client: %w", err)
	}

	if len(client.WindowIds) < 1 {
		return fmt.Errorf("error bootstrapping layout, no windows exist")
	}

	windowId := client.WindowIds[0]

	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		return fmt.Errorf("error getting window: %w", err)
	}

	workspace, err := wstore.DBMustGet[*waveobj.Workspace](ctx, window.WorkspaceId)
	if err != nil {
		return fmt.Errorf("error getting workspace: %w", err)
	}

	tabId := workspace.ActiveTabId

	starterLayout := GetStarterLayout()
	err = ApplyPortableLayout(ctx, tabId, starterLayout, false)
	if err != nil {
		return fmt.Errorf("error applying starter layout: %w", err)
	}

	return nil
}
