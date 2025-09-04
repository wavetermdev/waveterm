// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"context"
	"io/fs"
	"net/http"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

var defaultClient = makeClient()
var assetsFS fs.FS
var staticFS fs.FS
var manifestFileBytes []byte

// Default client methods that operate on the global defaultClient

func DefineComponent[P any](name string, renderFn func(ctx context.Context, props P) any) vdom.Component[P] {
	return defineComponentEx(defaultClient, name, renderFn)
}

func SetGlobalEventHandler(handler func(event vdom.VDomEvent)) {
	defaultClient.SetGlobalEventHandler(handler)
}

// RegisterSetupFn registers a single setup function that is called before the app starts running.
// Only one setup function is allowed, so calling this will replace any previously registered
// setup function.
func RegisterSetupFn(fn func()) {
	defaultClient.RegisterSetupFn(fn)
}

// SendAsyncInitiation notifies the frontend that the backend has updated state
// and requires a re-render. Normally the frontend calls the backend in response
// to events, but when the backend changes state independently (e.g., from a
// background process), this function gives the frontend a "nudge" to update.
func SendAsyncInitiation() error {
	return defaultClient.SendAsyncInitiation()
}

func SetAtomVals(m map[string]any) {
	defaultClient.SetAtomVals(m)
}

func SetAtomVal(name string, val any) {
	defaultClient.SetAtomVal(name, val)
}

func GetAtomVal(name string) any {
	return defaultClient.GetAtomVal(name)
}

// HandleDynFunc registers a dynamic HTTP handler function with the internal http.ServeMux.
// The pattern MUST start with "/dyn/" to be valid. This allows registration of dynamic
// routes that can be handled at runtime.
func HandleDynFunc(pattern string, fn func(http.ResponseWriter, *http.Request)) {
	defaultClient.HandleDynFunc(pattern, fn)
}

// RunMain is used internally by generated code and should not be called directly.
func RunMain() {
	defaultClient.RunMain()
}

// RegisterEmbeds is used internally by generated code and should not be called directly.
func RegisterEmbeds(assetsFilesystem fs.FS, staticFilesystem fs.FS, manifest []byte) {
	assetsFS = assetsFilesystem
	staticFS = staticFilesystem
	manifestFileBytes = manifest
}
