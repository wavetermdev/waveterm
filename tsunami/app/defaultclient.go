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

func AddSetupFn(fn func()) {
	defaultClient.AddSetupFn(fn)
}

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

func RegisterUrlPathHandler(path string, handler http.Handler) {
	defaultClient.RegisterUrlPathHandler(path, handler)
}

func RegisterFilePrefixHandler(prefix string, optionProvider func(path string) (*FileHandlerOption, error)) {
	defaultClient.RegisterFilePrefixHandler(prefix, optionProvider)
}

func RegisterFileHandler(path string, option FileHandlerOption) {
	defaultClient.RegisterFileHandler(path, option)
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
