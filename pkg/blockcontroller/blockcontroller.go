// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"encoding/base64"
	"fmt"
	"io/fs"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

const (
	Status_Running = "running"
	Status_Done    = "done"
	Status_Init    = "init"
)

const (
	DefaultTermMaxFileSize = 256 * 1024
	DefaultHtmlMaxFileSize = 256 * 1024
	MaxInitScriptSize      = 50 * 1024
)

const DefaultTimeout = 2 * time.Second
const DefaultGracefulKillWait = 400 * time.Millisecond

type BlockInputUnion struct {
	InputData []byte            `json:"inputdata,omitempty"`
	SigName   string            `json:"signame,omitempty"`
	TermSize  *waveobj.TermSize `json:"termsize,omitempty"`
}

type BlockControllerRuntimeStatus struct {
	BlockId           string `json:"blockid"`
	Version           int    `json:"version"`
	ShellProcStatus   string `json:"shellprocstatus,omitempty"`
	ShellProcConnName string `json:"shellprocconnname,omitempty"`
	ShellProcExitCode int    `json:"shellprocexitcode"`
}

// Controller interface that all block controllers must implement
type Controller interface {
	Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error
	Stop(graceful bool, newStatus string) error
	GetRuntimeStatus() *BlockControllerRuntimeStatus
	SendInput(input *BlockInputUnion) error
}

// Registry for all controllers
var (
	controllerRegistry = make(map[string]Controller)
	registryLock       sync.RWMutex
)

// Registry operations
func getController(blockId string) Controller {
	registryLock.RLock()
	defer registryLock.RUnlock()
	return controllerRegistry[blockId]
}

func registerController(blockId string, controller Controller) {
	var existingController Controller

	registryLock.Lock()
	existing, exists := controllerRegistry[blockId]
	if exists {
		existingController = existing
	}
	controllerRegistry[blockId] = controller
	registryLock.Unlock()

	if existingController != nil {
		existingController.Stop(false, Status_Done)
		wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
	}
}

func deleteController(blockId string) {
	registryLock.Lock()
	defer registryLock.Unlock()
	delete(controllerRegistry, blockId)
}

func getAllControllers() map[string]Controller {
	registryLock.RLock()
	defer registryLock.RUnlock()
	// Return a copy to avoid lock issues
	result := make(map[string]Controller)
	for k, v := range controllerRegistry {
		result[k] = v
	}
	return result
}

// Public API Functions

func ResyncController(ctx context.Context, tabId string, blockId string, rtOpts *waveobj.RuntimeOpts, force bool) error {
	if tabId == "" || blockId == "" {
		return fmt.Errorf("invalid tabId or blockId passed to ResyncController")
	}

	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	controllerName := blockData.Meta.GetString(waveobj.MetaKey_Controller, "")

	// Get existing controller
	existing := getController(blockId)

	// If no controller needed, stop existing if present
	if controllerName == "" {
		if existing != nil {
			StopBlockController(blockId)
			deleteController(blockId)
		}
		return nil
	}

	// Check if we need to morph controller type
	if existing != nil {
		existingStatus := existing.GetRuntimeStatus()
		needsReplace := false

		// Determine if existing controller type matches what we need
		switch existing.(type) {
		case *ShellController:
			if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
				needsReplace = true
			}
		}

		if needsReplace {
			log.Printf("stopping blockcontroller %s due to controller type change\n", blockId)
			StopBlockController(blockId)
			time.Sleep(100 * time.Millisecond)
			deleteController(blockId)
			existing = nil
		}

		// For shell/cmd, check if connection changed
		if !needsReplace && (controllerName == BlockController_Shell || controllerName == BlockController_Cmd) {
			connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")
			// Check if connection changed, including between different local connections
			if existingStatus.ShellProcStatus == Status_Running && existingStatus.ShellProcConnName != connName {
				log.Printf("stopping blockcontroller %s due to conn change (from %q to %q)\n", blockId, existingStatus.ShellProcConnName, connName)
				StopBlockControllerAndSetStatus(blockId, Status_Init)
				time.Sleep(100 * time.Millisecond)
				// Don't delete, will reuse same controller type
				existing = getController(blockId)
			}
		}
	}

	// Force restart if requested
	if force && existing != nil {
		StopBlockController(blockId)
		time.Sleep(100 * time.Millisecond)
		existing = getController(blockId)
	}

	// Create or restart controller
	var controller Controller
	if existing != nil {
		controller = existing
	} else {
		// Create new controller based on type
		switch controllerName {
		case BlockController_Shell, BlockController_Cmd:
			controller = MakeShellController(tabId, blockId, controllerName)
			registerController(blockId, controller)

		default:
			return fmt.Errorf("unknown controller type %q", controllerName)
		}
	}

	// Check if we need to start/restart
	status := controller.GetRuntimeStatus()
	if status.ShellProcStatus == Status_Init || status.ShellProcStatus == Status_Done {
		// For shell/cmd, check connection status first (for non-local connections)
		if controllerName == BlockController_Shell || controllerName == BlockController_Cmd {
			connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")
			if !conncontroller.IsLocalConnName(connName) {
				err = CheckConnStatus(blockId)
				if err != nil {
					return fmt.Errorf("cannot start shellproc: %w", err)
				}
			}
		}

		// Start controller
		err = controller.Start(ctx, blockData.Meta, rtOpts, force)
		if err != nil {
			return fmt.Errorf("error starting controller: %w", err)
		}
	}

	return nil
}

func GetBlockControllerRuntimeStatus(blockId string) *BlockControllerRuntimeStatus {
	controller := getController(blockId)
	if controller == nil {
		return nil
	}
	return controller.GetRuntimeStatus()
}

func StopBlockController(blockId string) {
	controller := getController(blockId)
	if controller == nil {
		return
	}
	controller.Stop(true, Status_Done)
	wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
}

func StopBlockControllerAndSetStatus(blockId string, newStatus string) {
	controller := getController(blockId)
	if controller == nil {
		return
	}
	controller.Stop(true, newStatus)
	wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
}

func SendInput(blockId string, inputUnion *BlockInputUnion) error {
	controller := getController(blockId)
	if controller == nil {
		return fmt.Errorf("no controller found for block %s", blockId)
	}
	return controller.SendInput(inputUnion)
}

func StopAllBlockControllers() {
	controllers := getAllControllers()
	for blockId, controller := range controllers {
		status := controller.GetRuntimeStatus()
		if status != nil && status.ShellProcStatus == Status_Running {
			go func(id string, c Controller) {
				c.Stop(true, Status_Done)
				wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, id))
			}(blockId, controller)
		}
	}
}

// StopAllBlockControllersForShutdown is an alias for StopAllBlockControllers used during shutdown
func StopAllBlockControllersForShutdown() {
	StopAllBlockControllers()
}

func getBoolFromMeta(meta map[string]any, key string, def bool) bool {
	ival, found := meta[key]
	if !found || ival == nil {
		return def
	}
	if val, ok := ival.(bool); ok {
		return val
	}
	return def
}

func getTermSize(bdata *waveobj.Block) waveobj.TermSize {
	if bdata.RuntimeOpts != nil {
		return bdata.RuntimeOpts.TermSize
	} else {
		return waveobj.TermSize{
			Rows: 25,
			Cols: 80,
		}
	}
}

func HandleAppendBlockFile(blockId string, blockFile string, data []byte) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.AppendData(ctx, blockId, blockFile, data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_BlockFile,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func HandleTruncateBlockFile(blockId string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.WriteFile(ctx, blockId, wavebase.BlockFile_Term, nil)
	if err == fs.ErrNotExist {
		return nil
	}
	if err != nil {
		return fmt.Errorf("error truncating blockfile: %w", err)
	}
	err = filestore.WFS.DeleteFile(ctx, blockId, wavebase.BlockFile_Cache)
	if err == fs.ErrNotExist {
		err = nil
	}
	if err != nil {
		log.Printf("error deleting cache file (continuing): %v\n", err)
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: wavebase.BlockFile_Term,
			FileOp:   wps.FileOp_Truncate,
		},
	})
	return nil

}

func debugLog(ctx context.Context, fmtStr string, args ...interface{}) {
	blocklogger.Infof(ctx, "[conndebug] "+fmtStr, args...)
	log.Printf(fmtStr, args...)
}

func CheckConnStatus(blockId string) error {
	bdata, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	connName := bdata.Meta.GetString(waveobj.MetaKey_Connection, "")
	if conncontroller.IsLocalConnName(connName) {
		return nil
	}
	if strings.HasPrefix(connName, "wsl://") {
		distroName := strings.TrimPrefix(connName, "wsl://")
		conn := wslconn.GetWslConn(distroName)
		connStatus := conn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return fmt.Errorf("not connected: %s", connStatus.Status)
		}
		return nil
	}
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(opts)
	connStatus := conn.DeriveConnStatus()
	if connStatus.Status != conncontroller.Status_Connected {
		return fmt.Errorf("not connected: %s", connStatus.Status)
	}
	return nil
}
