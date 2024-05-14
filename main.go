// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

// Note, main.go needs to be in the root of the project for the go:embed directive to work.

import (
	"embed"
	"log"

	"github.com/wavetermdev/thenextwave/pkg/blockstore"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

type GreetService struct{}

func (g *GreetService) Greet(name string) string {
	return "Hello " + name + "!"
}

func main() {
	err := wavebase.EnsureWaveHomeDir()
	if err != nil {
		log.Printf("error ensuring wave home dir: %v\n", err)
		return
	}
	log.Printf("wave home dir: %s\n", wavebase.GetWaveHomeDir())
	err = blockstore.InitBlockstore()
	if err != nil {
		log.Printf("error initializing blockstore: %v\n", err)
		return
	}

	app := application.New(application.Options{
		Name:        "NextWave",
		Description: "The Next Wave Terminal",
		Bind: []any{
			&GreetService{},
		},
		Icon: appIcon,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.NewWebviewWindowWithOptions(application.WebviewWindowOptions{
		Title: "Wave Terminal",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/public/index.html",
	})

	// blocking
	err = app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Printf("run error: %v\n", err)
	}
}
