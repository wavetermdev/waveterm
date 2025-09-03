// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"context"
	"io/fs"
	"net/http"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

var defaultClient = MakeClient(AppOpts{})
var assetsFS fs.FS
var staticFS fs.FS
var manifestFile *FileHandlerOption

// Default client methods that operate on the global defaultClient

func DefineComponent[P any](name string, renderFn func(ctx context.Context, props P) any) vdom.Component[P] {
	return DefineComponentEx(defaultClient, name, renderFn)
}

func SetGlobalEventHandler(handler func(client *Client, event vdom.VDomEvent)) {
	defaultClient.SetGlobalEventHandler(handler)
}

func SetAppOpts(appOpts AppOpts) {
	defaultClient.SetAppOpts(appOpts)
}

func AddSetupFn(fn func()) {
	defaultClient.AddSetupFn(fn)
}

func RunMain() {
	defaultClient.RunMain()
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

func RegisterAssetsFS(filesystem fs.FS) {
	assetsFS = filesystem
}

func RegisterStaticFS(filesystem fs.FS) {
	staticFS = filesystem
}

func RegisterManifestFile(option FileHandlerOption) {
	manifestFile = &option
}
