// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	SimpleId_This      = "this"
	SimpleId_Block     = "block"
	SimpleId_Tab       = "tab"
	SimpleId_Ws        = "ws"
	SimpleId_Workspace = "workspace"
	SimpleId_Client    = "client"
	SimpleId_Global    = "global"
	SimpleId_Temp      = "temp"
)

var (
	simpleTabNumRe = regexp.MustCompile(`^tab:(\d{1,3})$`)
	shortUUIDRe    = regexp.MustCompile(`^[0-9a-f]{8}$`)
	viewBlockRe    = regexp.MustCompile(`^([a-z]+)(?::(\d+))?$`) // Matches "ai" or "ai:2"
)

// First function: detect/choose discriminator
func parseSimpleId(simpleId string) (discriminator string, value string, err error) {
	// Check for explicit discriminator with @
	if parts := strings.SplitN(simpleId, "@", 2); len(parts) == 2 {
		return parts[0], parts[1], nil
	}

	// Handle special keywords
	if simpleId == SimpleId_This || simpleId == SimpleId_Block || simpleId == SimpleId_Tab ||
		simpleId == SimpleId_Ws || simpleId == SimpleId_Workspace ||
		simpleId == SimpleId_Client || simpleId == SimpleId_Global || simpleId == SimpleId_Temp {
		return "this", simpleId, nil
	}

	// Check if it's a simple ORef (type:uuid)
	if _, err := waveobj.ParseORef(simpleId); err == nil {
		return "oref", simpleId, nil
	}

	// Check for tab:N format
	if simpleTabNumRe.MatchString(simpleId) {
		return "tabnum", simpleId, nil
	}

	// check for [view]:N format
	if viewBlockRe.MatchString(simpleId) {
		return "view", simpleId, nil
	}

	// Check for plain number (block reference)
	if _, err := strconv.Atoi(simpleId); err == nil {
		return "blocknum", simpleId, nil
	}

	// Check for UUIDs
	if _, err := uuid.Parse(simpleId); err == nil {
		return "uuid", simpleId, nil
	}
	if shortUUIDRe.MatchString(strings.ToLower(simpleId)) {
		return "uuid8", simpleId, nil
	}

	return "", "", fmt.Errorf("invalid simple id format: %s", simpleId)
}

// Individual resolvers
func resolveThis(ctx context.Context, data wshrpc.CommandResolveIdsData, value string) (*waveobj.ORef, error) {
	if data.BlockId == "" {
		return nil, fmt.Errorf("no blockid in request")
	}

	if value == SimpleId_This || value == SimpleId_Block {
		return &waveobj.ORef{OType: waveobj.OType_Block, OID: data.BlockId}, nil
	}
	if value == SimpleId_Tab {
		tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
		if err != nil {
			return nil, fmt.Errorf("error finding tab: %v", err)
		}
		return &waveobj.ORef{OType: waveobj.OType_Tab, OID: tabId}, nil
	}
	if value == SimpleId_Ws || value == SimpleId_Workspace {
		tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
		if err != nil {
			return nil, fmt.Errorf("error finding tab: %v", err)
		}
		wsId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
		if err != nil {
			return nil, fmt.Errorf("error finding workspace: %v", err)
		}
		return &waveobj.ORef{OType: waveobj.OType_Workspace, OID: wsId}, nil
	}
	if value == SimpleId_Client || value == SimpleId_Global {
		clientId := wstore.GetClientId()
		return &waveobj.ORef{OType: waveobj.OType_Client, OID: clientId}, nil
	}
	if value == SimpleId_Temp {
		client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
		if err != nil {
			return nil, fmt.Errorf("error getting client: %v", err)
		}
		return &waveobj.ORef{OType: "temp", OID: client.TempOID}, nil
	}
	return nil, fmt.Errorf("invalid value for 'this' resolver: %s", value)
}

func resolveORef(_ context.Context, value string) (*waveobj.ORef, error) {
	parsedORef, err := waveobj.ParseORef(value)
	if err != nil {
		return nil, fmt.Errorf("error parsing oref: %v", err)
	}
	return &parsedORef, nil
}

func resolveTabNum(ctx context.Context, data wshrpc.CommandResolveIdsData, value string) (*waveobj.ORef, error) {
	m := simpleTabNumRe.FindStringSubmatch(value)
	if m == nil {
		return nil, fmt.Errorf("error parsing simple tab id: %s", value)
	}

	tabNum, err := strconv.Atoi(m[1])
	if err != nil {
		return nil, fmt.Errorf("error parsing simple tab num: %v", err)
	}

	curTabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
	if err != nil {
		return nil, fmt.Errorf("error finding tab for block: %v", err)
	}

	wsId, err := wstore.DBFindWorkspaceForTabId(ctx, curTabId)
	if err != nil {
		return nil, fmt.Errorf("error finding current workspace: %v", err)
	}

	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, wsId)
	if err != nil {
		return nil, fmt.Errorf("error getting workspace: %v", err)
	}

	numTabs := len(ws.TabIds)
	if tabNum < 1 || tabNum > numTabs {
		return nil, fmt.Errorf("tab num out of range, workspace has %d tabs", numTabs)
	}

	tabIdx := tabNum - 1
	resolvedTabId := ws.TabIds[tabIdx]
	return &waveobj.ORef{OType: waveobj.OType_Tab, OID: resolvedTabId}, nil
}

func resolveBlock(ctx context.Context, data wshrpc.CommandResolveIdsData, value string) (*waveobj.ORef, error) {
	blockNum, err := strconv.Atoi(value)
	if err != nil {
		return nil, fmt.Errorf("error parsing block number: %v", err)
	}

	tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
	if err != nil {
		return nil, fmt.Errorf("error finding tab for blockid %s: %w", data.BlockId, err)
	}

	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error retrieving tab %s: %w", tabId, err)
	}

	layout, err := wstore.DBGet[*waveobj.LayoutState](ctx, tab.LayoutState)
	if err != nil {
		return nil, fmt.Errorf("error retrieving layout state %s: %w", tab.LayoutState, err)
	}

	if layout.LeafOrder == nil {
		return nil, fmt.Errorf("could not resolve block num %v, leaf order is empty", blockNum)
	}

	leafIndex := blockNum - 1 // block nums are 1-indexed
	if len(*layout.LeafOrder) <= leafIndex {
		return nil, fmt.Errorf("could not find a node in the layout matching blockNum %v", blockNum)
	}

	leafEntry := (*layout.LeafOrder)[leafIndex]
	return &waveobj.ORef{OType: waveobj.OType_Block, OID: leafEntry.BlockId}, nil
}

func resolveView(ctx context.Context, data wshrpc.CommandResolveIdsData, value string) (*waveobj.ORef, error) {
	matches := viewBlockRe.FindStringSubmatch(value)
	if matches == nil {
		return nil, fmt.Errorf("invalid view format: %s", value)
	}

	// Default to first instance if no number specified
	viewType := matches[1]
	instanceNum := 1
	if matches[2] != "" {
		num, err := strconv.Atoi(matches[2])
		if err != nil {
			return nil, fmt.Errorf("invalid view instance number: %v", err)
		}
		instanceNum = num
	}
	if instanceNum < 1 {
		return nil, fmt.Errorf("invalid view instance number: %d", instanceNum)
	}
	// Get current tab
	tabId, err := wstore.DBFindTabForBlockId(ctx, data.BlockId)
	if err != nil {
		return nil, fmt.Errorf("error finding tab: %v", err)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error retrieving tab: %v", err)
	}
	layout, err := wstore.DBMustGet[*waveobj.LayoutState](ctx, tab.LayoutState)
	if err != nil {
		return nil, fmt.Errorf("error retrieving layout: %v", err)
	}
	if layout.LeafOrder == nil {
		return nil, fmt.Errorf("no blocks in layout")
	}
	// Find nth instance of view type
	count := 0
	for _, leaf := range *layout.LeafOrder {
		leafBlockId := leaf.BlockId
		leafBlock, err := wstore.DBMustGet[*waveobj.Block](ctx, leafBlockId)
		if err != nil {
			continue
		}
		if leafBlock.Meta.GetString("view", "") == viewType {
			count++
			if count == instanceNum {
				return &waveobj.ORef{OType: waveobj.OType_Block, OID: leaf.BlockId}, nil
			}
		}
	}
	return nil, fmt.Errorf("could not find block %d of type %s (found %d)", instanceNum, viewType, count)
}

func resolveUUID(ctx context.Context, value string) (*waveobj.ORef, error) {
	return wstore.DBResolveEasyOID(ctx, value)
}

// Main resolver function
func resolveSimpleId(ctx context.Context, data wshrpc.CommandResolveIdsData, simpleId string) (*waveobj.ORef, error) {
	discriminator, value, err := parseSimpleId(simpleId)
	if err != nil {
		return nil, err
	}
	switch discriminator {
	case "this":
		return resolveThis(ctx, data, value)
	case "oref":
		return resolveORef(ctx, value)
	case "tabnum":
		return resolveTabNum(ctx, data, value)
	case "blocknum":
		return resolveBlock(ctx, data, value)
	case "view":
		return resolveView(ctx, data, value)
	case "uuid", "uuid8":
		return resolveUUID(ctx, value)
	default:
		return nil, fmt.Errorf("unknown discriminator: %s", discriminator)
	}
}
