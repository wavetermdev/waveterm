// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

// Note, main.go needs to be in the root of the project for the go:embed directive to work.

import (
	"context"
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/blockstore"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/service/blockservice"
	"github.com/wavetermdev/thenextwave/pkg/service/clientservice"
	"github.com/wavetermdev/thenextwave/pkg/service/fileservice"
	"github.com/wavetermdev/thenextwave/pkg/service/objectservice"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wstore"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed dist
var assets embed.FS

//go:embed build/icons.icns
var appIcon []byte

func createAppMenu(app *application.App) *application.Menu {
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)
	fileMenu := menu.AddSubmenu("File")
	// newWindow := fileMenu.Add("New Window")
	// newWindow.OnClick(func(appContext *application.Context) {
	// 	createWindow(app)
	// })
	closeWindow := fileMenu.Add("Close Window")
	closeWindow.OnClick(func(appContext *application.Context) {
		app.CurrentWindow().Close()
	})
	menu.AddRole(application.EditMenu)
	menu.AddRole(application.ViewMenu)
	menu.AddRole(application.WindowMenu)
	menu.AddRole(application.HelpMenu)
	return menu
}

func createWindow(windowData *wstore.Window, app *application.App) {
	client, err := wstore.DBGetSingleton[*wstore.Client](context.Background())
	if err != nil {
		panic(fmt.Errorf("error getting client data: %w", err))
	}
	window := app.NewWebviewWindowWithOptions(application.WebviewWindowOptions{
		Title: "Wave Terminal",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(0, 0, 0),
		URL:              "/public/index.html?windowid=" + windowData.OID + "&clientid=" + client.OID,
		X:                windowData.Pos.X,
		Y:                windowData.Pos.Y,
		Width:            windowData.WinSize.Width,
		Height:           windowData.WinSize.Height,
	})
	eventbus.RegisterWailsWindow(window, windowData.OID)
	window.On(events.Common.WindowClosing, func(event *application.WindowEvent) {
		eventbus.UnregisterWailsWindow(window.ID())
	})
	window.Show()
}

type waveAssetHandler struct {
	AssetHandler http.Handler
}

func serveWaveUrls(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/wave/stream-file" {
		fileName := r.URL.Query().Get("path")
		fileName = wavebase.ExpandHomeDir(fileName)
		http.ServeFile(w, r, fileName)
		return
	}
	http.NotFound(w, r)
}

func (wah waveAssetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/wave/") {
		serveWaveUrls(w, r)
		return
	}
	wah.AssetHandler.ServeHTTP(w, r)
}

func doShutdown(reason string) {
	log.Printf("shutting down: %s\n", reason)
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	// TODO deal with flush in progress
	blockstore.GBS.FlushCache(ctx)
	time.Sleep(200 * time.Millisecond)
	os.Exit(0)
}

func installShutdownSignalHandlers() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		for sig := range sigCh {
			doShutdown(fmt.Sprintf("got signal %v", sig))
			break
		}
	}()
}

func main() {
	err := wavebase.EnsureWaveHomeDir()
	if err != nil {
		log.Printf("error ensuring wave home dir: %v\n", err)
		return
	}
	waveLock, err := wavebase.AcquireWaveLock()
	if err != nil {
		log.Printf("error acquiring wave lock (another instance of Wave is likely running): %v\n", err)
		return
	}

	log.Printf("wave home dir: %s\n", wavebase.GetWaveHomeDir())
	err = blockstore.InitBlockstore()
	if err != nil {
		log.Printf("error initializing blockstore: %v\n", err)
		return
	}
	err = wstore.InitWStore()
	if err != nil {
		log.Printf("error initializing wstore: %v\n", err)
		return
	}
	err = wstore.EnsureInitialData()
	if err != nil {
		log.Printf("error ensuring initial data: %v\n", err)
		return
	}
	installShutdownSignalHandlers()

	app := application.New(application.Options{
		Name:        "NextWave",
		Description: "The Next Wave Terminal",
		Services: []application.Service{
			application.NewService(&fileservice.FileService{}),
			application.NewService(&blockservice.BlockService{}),
			application.NewService(&clientservice.ClientService{}),
			application.NewService(&objectservice.ObjectService{}),
		},
		Icon: appIcon,
		Assets: application.AssetOptions{
			Handler: waveAssetHandler{AssetHandler: application.AssetFileServerFS(assets)},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	menu := createAppMenu(app)
	app.SetMenu(menu)
	eventbus.RegisterWailsApp(app)

	setupCtx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*wstore.Client](setupCtx)
	if err != nil {
		log.Printf("error getting client data: %v\n", err)
		return
	}
	mainWindow, err := wstore.DBGet[*wstore.Window](setupCtx, client.MainWindowId)
	if err != nil {
		log.Printf("error getting main window: %v\n", err)
		return
	}
	if mainWindow == nil {
		log.Printf("no main window data\n")
		return
	}
	createWindow(mainWindow, app)

	eventbus.Start()
	defer eventbus.Shutdown()

	// blocking
	err = app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Printf("run error: %v\n", err)
	}
	runtime.KeepAlive(waveLock)
}
