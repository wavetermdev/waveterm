// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func init() {
	for _, rtype := range waveobj.AllWaveObjTypes() {
		waveobj.RegisterType(rtype)
	}
}

func UpdateTabName(ctx context.Context, tabId, name string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		tab, _ := DBGet[*waveobj.Tab](tx.Context(), tabId)
		if tab == nil {
			return fmt.Errorf("tab not found: %q", tabId)
		}
		if tabId != "" {
			tab.Name = name
			DBUpdate(tx.Context(), tab)
		}
		return nil
	})
}

func UpdateObjectMeta(ctx context.Context, oref waveobj.ORef, meta waveobj.MetaMapType, mergeSpecial bool) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		if oref.IsEmpty() {
			return fmt.Errorf("empty object reference")
		}
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return ErrNotFound
		}
		objMeta := waveobj.GetMeta(obj)
		if objMeta == nil {
			objMeta = make(map[string]any)
		}
		newMeta := waveobj.MergeMeta(objMeta, meta, mergeSpecial)
		waveobj.SetMeta(obj, newMeta)
		DBUpdate(tx.Context(), obj)
		return nil
	})
}

// UpdateObjectMetaWithVersion performs an optimistic locking update.
// If expectedVersion > 0 and doesn't match current version, returns ErrVersionMismatch.
// If expectedVersion == 0, behaves like UpdateObjectMeta (no version check).
func UpdateObjectMetaWithVersion(ctx context.Context, oref waveobj.ORef, meta waveobj.MetaMapType, expectedVersion int, mergeSpecial bool) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		if oref.IsEmpty() {
			return fmt.Errorf("empty object reference")
		}
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return ErrNotFound
		}

		// Optimistic locking check
		currentVersion := waveobj.GetVersion(obj)
		if expectedVersion > 0 && currentVersion != expectedVersion {
			return fmt.Errorf("%w: expected %d, got %d", ErrVersionMismatch, expectedVersion, currentVersion)
		}

		objMeta := waveobj.GetMeta(obj)
		if objMeta == nil {
			objMeta = make(map[string]any)
		}
		newMeta := waveobj.MergeMeta(objMeta, meta, mergeSpecial)
		waveobj.SetMeta(obj, newMeta)
		if err := DBUpdate(tx.Context(), obj); err != nil {
			return fmt.Errorf("failed to update object: %w", err)
		}
		return nil
	})
}

// UpdateObjectMetaIfNotLocked atomically checks lock and updates.
// Returns ErrObjectLocked if locked, or ErrVersionMismatch if version doesn't match.
// This eliminates the TOCTOU vulnerability in lock checking.
func UpdateObjectMetaIfNotLocked(ctx context.Context, oref waveobj.ORef, meta waveobj.MetaMapType, lockKey string, expectedVersion int) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		if oref.IsEmpty() {
			return fmt.Errorf("empty object reference")
		}
		obj, _ := DBGetORef(tx.Context(), oref)
		if obj == nil {
			return ErrNotFound
		}

		currentVersion := waveobj.GetVersion(obj)
		if expectedVersion > 0 && currentVersion != expectedVersion {
			return fmt.Errorf("%w: expected %d, got %d", ErrVersionMismatch, expectedVersion, currentVersion)
		}

		// Atomic lock check INSIDE transaction
		objMeta := waveobj.GetMeta(obj)
		if objMeta != nil {
			if locked, ok := objMeta[lockKey].(bool); ok && locked {
				return fmt.Errorf("%w: %w", ErrVersionMismatch, ErrObjectLocked)
			}
		}

		if objMeta == nil {
			objMeta = make(map[string]any)
		}
		newMeta := waveobj.MergeMeta(objMeta, meta, false)
		waveobj.SetMeta(obj, newMeta)
		if err := DBUpdate(tx.Context(), obj); err != nil {
			return fmt.Errorf("failed to update object: %w", err)
		}
		return nil
	})
}

func MoveBlockToTab(ctx context.Context, currentTabId string, newTabId string, blockId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		block, _ := DBGet[*waveobj.Block](tx.Context(), blockId)
		if block == nil {
			return fmt.Errorf("block not found: %q", blockId)
		}
		currentTab, _ := DBGet[*waveobj.Tab](tx.Context(), currentTabId)
		if currentTab == nil {
			return fmt.Errorf("current tab not found: %q", currentTabId)
		}
		newTab, _ := DBGet[*waveobj.Tab](tx.Context(), newTabId)
		if newTab == nil {
			return fmt.Errorf("new tab not found: %q", newTabId)
		}
		blockIdx := utilfn.FindStringInSlice(currentTab.BlockIds, blockId)
		if blockIdx == -1 {
			return fmt.Errorf("block not found in current tab: %q", blockId)
		}
		currentTab.BlockIds = utilfn.RemoveElemFromSlice(currentTab.BlockIds, blockId)
		newTab.BlockIds = append(newTab.BlockIds, blockId)
		block.ParentORef = waveobj.MakeORef(waveobj.OType_Tab, newTabId).String()
		DBUpdate(tx.Context(), block)
		DBUpdate(tx.Context(), currentTab)
		DBUpdate(tx.Context(), newTab)
		return nil
	})
}
