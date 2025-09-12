// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"encoding/json"
	"io/fs"
	"net/http"

	"github.com/wavetermdev/waveterm/tsunami/engine"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

func DefineComponent[P any](name string, renderFn func(props P) any) vdom.Component[P] {
	return engine.DefineComponentEx(engine.GetDefaultClient(), name, renderFn)
}

func Ptr[T any](v T) *T {
	return &v
}

func SetGlobalEventHandler(handler func(event vdom.VDomEvent)) {
	engine.GetDefaultClient().SetGlobalEventHandler(handler)
}

// RegisterSetupFn registers a single setup function that is called before the app starts running.
// Only one setup function is allowed, so calling this will replace any previously registered
// setup function.
func RegisterSetupFn(fn func()) {
	engine.GetDefaultClient().RegisterSetupFn(fn)
}

// SendAsyncInitiation notifies the frontend that the backend has updated state
// and requires a re-render. Normally the frontend calls the backend in response
// to events, but when the backend changes state independently (e.g., from a
// background process), this function gives the frontend a "nudge" to update.
func SendAsyncInitiation() error {
	return engine.GetDefaultClient().SendAsyncInitiation()
}

func ConfigAtom[T any](name string, defaultValue T, meta *AtomMeta) Atom[T] {
	fullName := "$config." + name
	client := engine.GetDefaultClient()
	engineMeta := convertAppMetaToEngineMeta(meta)
	atom := engine.MakeAtomImpl(defaultValue, engineMeta)
	client.Root.RegisterAtom(fullName, atom)
	return Atom[T]{name: fullName, client: client}
}

func DataAtom[T any](name string, defaultValue T, meta *AtomMeta) Atom[T] {
	fullName := "$data." + name
	client := engine.GetDefaultClient()
	engineMeta := convertAppMetaToEngineMeta(meta)
	atom := engine.MakeAtomImpl(defaultValue, engineMeta)
	client.Root.RegisterAtom(fullName, atom)
	return Atom[T]{name: fullName, client: client}
}

func SharedAtom[T any](name string, defaultValue T) Atom[T] {
	fullName := "$shared." + name
	client := engine.GetDefaultClient()
	atom := engine.MakeAtomImpl(defaultValue, nil)
	client.Root.RegisterAtom(fullName, atom)
	return Atom[T]{name: fullName, client: client}
}

func convertAppMetaToEngineMeta(appMeta *AtomMeta) *engine.AtomMeta {
	if appMeta == nil {
		return nil
	}
	return &engine.AtomMeta{
		Description: appMeta.Desc,
		Units:       appMeta.Units,
		Min:         appMeta.Min,
		Max:         appMeta.Max,
		Enum:        appMeta.Enum,
		Pattern:     appMeta.Pattern,
	}
}

// HandleDynFunc registers a dynamic HTTP handler function with the internal http.ServeMux.
// The pattern MUST start with "/dyn/" to be valid. This allows registration of dynamic
// routes that can be handled at runtime.
func HandleDynFunc(pattern string, fn func(http.ResponseWriter, *http.Request)) {
	engine.GetDefaultClient().HandleDynFunc(pattern, fn)
}

// RunMain is used internally by generated code and should not be called directly.
func RunMain() {
	engine.GetDefaultClient().RunMain()
}

// RegisterEmbeds is used internally by generated code and should not be called directly.
func RegisterEmbeds(assetsFilesystem fs.FS, staticFilesystem fs.FS, manifest []byte) {
	client := engine.GetDefaultClient()
	client.AssetsFS = assetsFilesystem
	client.StaticFS = staticFilesystem
	client.ManifestFileBytes = manifest
}

// DeepCopy creates a deep copy of the input value using JSON marshal/unmarshal.
// Panics on JSON errors.
func DeepCopy[T any](v T) T {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var result T
	err = json.Unmarshal(data, &result)
	if err != nil {
		panic(err)
	}
	return result
}

// QueueRefOp queues a reference operation to be executed on the DOM element.
// Operations include actions like "focus", "scrollIntoView", etc.
// If the ref is nil or not current, the operation is ignored.
// This function must be called within a component context.
func QueueRefOp(ref *vdom.VDomRef, op vdom.VDomRefOperation) {
	if ref == nil || !ref.HasCurrent {
		return
	}
	if op.RefId == "" {
		op.RefId = ref.RefId
	}
	client := engine.GetDefaultClient()
	client.Root.QueueRefOp(op)
}
