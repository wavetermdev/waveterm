// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package objectservice

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockcontroller"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

type ObjectService struct{}

const DefaultTimeout = 2 * time.Second

func parseORef(oref string) (*waveobj.ORef, error) {
	fields := strings.Split(oref, ":")
	if len(fields) != 2 {
		return nil, fmt.Errorf("invalid object reference: %q", oref)
	}
	return &waveobj.ORef{OType: fields[0], OID: fields[1]}, nil
}

func (svc *ObjectService) GetObject(orefStr string) (any, error) {
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, err
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	obj, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	rtn, err := waveobj.ToJsonMap(obj)
	return rtn, err
}

func (svc *ObjectService) GetObjects(orefStrArr []string) (any, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	var orefArr []waveobj.ORef
	for _, orefStr := range orefStrArr {
		orefObj, err := parseORef(orefStr)
		if err != nil {
			return nil, err
		}
		orefArr = append(orefArr, *orefObj)
	}
	return wstore.DBSelectORefs(ctx, orefArr)
}

func updatesRtn(ctx context.Context, rtnVal map[string]any) (any, error) {
	updates := wstore.ContextGetUpdates(ctx)
	if len(updates) == 0 {
		return nil, nil
	}
	updateArr := make([]wstore.WaveObjUpdate, 0, len(updates))
	for _, update := range updates {
		updateArr = append(updateArr, update)
	}
	jval, err := json.Marshal(updateArr)
	if err != nil {
		return nil, fmt.Errorf("error converting updates to JSON: %w", err)
	}
	if rtnVal == nil {
		rtnVal = make(map[string]any)
	}
	rtnVal["updates"] = json.RawMessage(jval)
	return rtnVal, nil
}

func (svc *ObjectService) AddTabToWorkspace(uiContext wstore.UIContext, tabName string, activateTab bool) (any, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	windowData, err := wstore.DBMustGet[*wstore.Window](ctx, uiContext.WindowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	tab, err := wstore.CreateTab(ctx, windowData.WorkspaceId, tabName)
	if err != nil {
		return nil, fmt.Errorf("error creating tab: %w", err)
	}
	if activateTab {
		err = wstore.SetActiveTab(ctx, uiContext.WindowId, tab.OID)
		if err != nil {
			return nil, fmt.Errorf("error setting active tab: %w", err)
		}
	}
	rtn := make(map[string]any)
	rtn["tabid"] = waveobj.GetOID(tab)
	return updatesRtn(ctx, rtn)
}

func (svc *ObjectService) SetActiveTab(uiContext wstore.UIContext, tabId string) (any, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	err := wstore.SetActiveTab(ctx, uiContext.WindowId, tabId)
	if err != nil {
		return nil, fmt.Errorf("error setting active tab: %w", err)
	}
	return updatesRtn(ctx, nil)
}

func (svc *ObjectService) CreateBlock(uiContext wstore.UIContext, blockDef *wstore.BlockDef, rtOpts *wstore.RuntimeOpts) (any, error) {
	if uiContext.ActiveTabId == "" {
		return nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = wstore.ContextWithUpdates(ctx)
	blockData, err := wstore.CreateBlock(ctx, uiContext.ActiveTabId, blockDef, rtOpts)
	if err != nil {
		return nil, fmt.Errorf("error creating block: %w", err)
	}
	if blockData.Controller != "" {
		err = blockcontroller.StartBlockController(ctx, blockData.OID)
		if err != nil {
			return nil, fmt.Errorf("error starting block controller: %w", err)
		}
	}
	rtn := make(map[string]any)
	rtn["blockid"] = blockData.OID
	return updatesRtn(ctx, rtn)
}
