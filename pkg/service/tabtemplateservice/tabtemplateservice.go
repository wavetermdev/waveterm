// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tabtemplateservice

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const DefaultTimeout = 2 * time.Second

type TabTemplateService struct{}

func (svc *TabTemplateService) SaveTabAsTemplate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "tabId", "name"},
		ReturnDesc: "templateId",
	}
}

// SaveTabAsTemplate captures the current tab layout and saves it as a template
func (svc *TabTemplateService) SaveTabAsTemplate(ctx context.Context, tabId string, name string) (string, error) {
	layoutTree, err := wcore.CaptureTabAsLayoutTree(ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("error capturing tab layout: %w", err)
	}

	templateId := uuid.NewString()
	template := &waveobj.TabTemplate{
		OID:        templateId,
		Version:    1,
		Name:       name,
		SrcTabId:   tabId,
		LayoutTree: layoutTree,
		Meta:       waveobj.MetaMapType{},
	}

	err = wstore.DBInsert(ctx, template)
	if err != nil {
		return "", fmt.Errorf("error saving template: %w", err)
	}

	return templateId, nil
}

func (svc *TabTemplateService) GetTabTemplate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"templateId"},
		ReturnDesc: "template",
	}
}

// GetTabTemplate retrieves a template by ID
func (svc *TabTemplateService) GetTabTemplate(templateId string) (*waveobj.TabTemplate, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	template, err := wstore.DBGet[*waveobj.TabTemplate](ctx, templateId)
	if err != nil {
		return nil, fmt.Errorf("error getting template: %w", err)
	}
	return template, nil
}

func (svc *TabTemplateService) ListTabTemplates_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ReturnDesc: "templates",
	}
}

// ListTabTemplates returns all saved templates
func (svc *TabTemplateService) ListTabTemplates() ([]*waveobj.TabTemplate, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	templates, err := wstore.DBGetAllObjsByType[*waveobj.TabTemplate](ctx, waveobj.OType_TabTemplate)
	if err != nil {
		return nil, fmt.Errorf("error listing templates: %w", err)
	}
	return templates, nil
}

func (svc *TabTemplateService) UpdateTabTemplate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"ctx", "templateId", "name"},
	}
}

// UpdateTabTemplate updates a template's name
func (svc *TabTemplateService) UpdateTabTemplate(ctx context.Context, templateId string, name string) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)

	template, err := wstore.DBGet[*waveobj.TabTemplate](ctx, templateId)
	if err != nil {
		return nil, fmt.Errorf("error getting template: %w", err)
	}
	if template == nil {
		return nil, fmt.Errorf("template not found: %s", templateId)
	}

	template.Name = name
	err = wstore.DBUpdate(ctx, template)
	if err != nil {
		return nil, fmt.Errorf("error updating template: %w", err)
	}

	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("TabTemplateService:UpdateTabTemplate:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()

	return updates, nil
}

func (svc *TabTemplateService) DeleteTabTemplate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"templateId"},
	}
}

// DeleteTabTemplate removes a template
func (svc *TabTemplateService) DeleteTabTemplate(templateId string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	err := wstore.DBDelete(ctx, waveobj.OType_TabTemplate, templateId)
	if err != nil {
		return fmt.Errorf("error deleting template: %w", err)
	}
	return nil
}

func (svc *TabTemplateService) CreateTabFromTemplate_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"ctx", "workspaceId", "templateId"},
		ReturnDesc: "tabId",
	}
}

// CreateTabFromTemplate creates a new tab using a template's layout
func (svc *TabTemplateService) CreateTabFromTemplate(ctx context.Context, workspaceId string, templateId string) (string, waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)

	// Get the template
	template, err := wstore.DBGet[*waveobj.TabTemplate](ctx, templateId)
	if err != nil {
		return "", nil, fmt.Errorf("error getting template: %w", err)
	}
	if template == nil {
		return "", nil, fmt.Errorf("template not found: %s", templateId)
	}

	// Create a new tab
	tabId, err := wcore.CreateTab(ctx, workspaceId, template.Name, true, false)
	if err != nil {
		return "", nil, fmt.Errorf("error creating tab: %w", err)
	}

	// Apply the template's layout — prefer LayoutTree (full tree, correct flexDirections)
	// fall back to Layout (flat leaf list) for templates saved before this fix
	if template.LayoutTree != nil {
		err = wcore.ApplyLayoutTree(ctx, tabId, template.LayoutTree, true)
	} else {
		err = wcore.ApplyPortableLayout(ctx, tabId, template.Layout, true)
	}
	if err != nil {
		return "", nil, fmt.Errorf("error applying template layout: %w", err)
	}

	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("TabTemplateService:CreateTabFromTemplate:SendUpdateEvents", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()

	return tabId, updates, nil
}
