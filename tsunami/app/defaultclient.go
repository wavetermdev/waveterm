// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/engine"
	"github.com/wavetermdev/waveterm/tsunami/util"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

const TsunamiCloseOnStdinEnvVar = "TSUNAMI_CLOSEONSTDIN"
const MaxShortDescLen = 120

type AppMeta engine.AppMeta

type staticFileInfo struct {
	fullPath string
	info     fs.FileInfo
}

func (sfi *staticFileInfo) Name() string       { return sfi.fullPath }
func (sfi *staticFileInfo) Size() int64        { return sfi.info.Size() }
func (sfi *staticFileInfo) Mode() fs.FileMode  { return sfi.info.Mode() }
func (sfi *staticFileInfo) ModTime() time.Time { return sfi.info.ModTime() }
func (sfi *staticFileInfo) IsDir() bool        { return sfi.info.IsDir() }
func (sfi *staticFileInfo) Sys() any           { return sfi.info.Sys() }

func DefineComponent[P any](name string, renderFn func(props P) any) vdom.Component[P] {
	return engine.DefineComponentEx(engine.GetDefaultClient(), name, renderFn)
}

func Ptr[T any](v T) *T {
	return &v
}

func SetGlobalEventHandler(handler func(event vdom.VDomEvent)) {
	engine.GetDefaultClient().SetGlobalEventHandler(handler)
}

// RegisterAppInitFn registers a single setup function that is called before the app starts running.
// Only one setup function is allowed, so calling this will replace any previously registered
// setup function.
func RegisterAppInitFn(fn func() error) {
	engine.GetDefaultClient().RegisterAppInitFn(fn)
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
	closeOnStdin := os.Getenv(TsunamiCloseOnStdinEnvVar) != ""

	if closeOnStdin {
		go func() {
			// Read stdin until EOF/close, then exit the process
			io.Copy(io.Discard, os.Stdin)
			log.Printf("[tsunami] shutting down due to close of stdin\n")
			os.Exit(0)
		}()
	}

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

func SetAppMeta(meta AppMeta) {
	meta.ShortDesc = util.TruncateString(meta.ShortDesc, MaxShortDescLen)
	client := engine.GetDefaultClient()
	client.SetAppMeta(engine.AppMeta(meta))
}

func SetTitle(title string) {
	client := engine.GetDefaultClient()
	m := client.GetAppMeta()
	m.Title = title
	client.SetAppMeta(m)
}

func SetShortDesc(shortDesc string) {
	shortDesc = util.TruncateString(shortDesc, MaxShortDescLen)
	client := engine.GetDefaultClient()
	m := client.GetAppMeta()
	m.ShortDesc = shortDesc
	client.SetAppMeta(m)
}

func DeclareSecret(secretName string, meta *SecretMeta) string {
	client := engine.GetDefaultClient()
	var secretDesc string
	var secretOptional bool
	if meta != nil {
		secretDesc = meta.Desc
		secretOptional = meta.Optional
	}
	client.DeclareSecret(secretName, secretDesc, secretOptional)
	return os.Getenv(secretName)
}

func PrintAppManifest() {
	client := engine.GetDefaultClient()
	client.PrintAppManifest()
}

// ReadStaticFile reads a file from the embedded static filesystem.
// The path MUST start with "static/" (e.g., "static/config.json").
// Returns the file contents or an error if the file doesn't exist or can't be read.
func ReadStaticFile(path string) ([]byte, error) {
	client := engine.GetDefaultClient()
	if client.StaticFS == nil {
		return nil, errors.New("static files not available before app initialization; use AppInit to access files during initialization")
	}
	if !strings.HasPrefix(path, "static/") {
		return nil, fmt.Errorf("ReadStaticFile path must start with 'static/': %w", fs.ErrNotExist)
	}
	// Strip "static/" prefix since the FS is already sub'd to the static directory
	relativePath := strings.TrimPrefix(path, "static/")
	return fs.ReadFile(client.StaticFS, relativePath)
}

// OpenStaticFile opens a file from the embedded static filesystem.
// The path MUST start with "static/" (e.g., "static/config.json").
// Returns an fs.File or an error if the file doesn't exist or can't be opened.
func OpenStaticFile(path string) (fs.File, error) {
	client := engine.GetDefaultClient()
	if client.StaticFS == nil {
		return nil, errors.New("static files not available before app initialization; use AppInit to access files during initialization")
	}
	if !strings.HasPrefix(path, "static/") {
		return nil, fmt.Errorf("OpenStaticFile path must start with 'static/': %w", fs.ErrNotExist)
	}
	// Strip "static/" prefix since the FS is already sub'd to the static directory
	relativePath := strings.TrimPrefix(path, "static/")
	return client.StaticFS.Open(relativePath)
}

// ListStaticFiles returns FileInfo for all files in the embedded static filesystem.
// The Name() of each FileInfo will be the full path prefixed with "static/" (e.g., "static/config.json"),
// which can be passed directly to ReadStaticFile or OpenStaticFile.
// Returns an empty slice if StaticFS is nil or on error.
func ListStaticFiles() ([]fs.FileInfo, error) {
	client := engine.GetDefaultClient()
	if client.StaticFS == nil {
		return nil, nil
	}

	var fileInfos []fs.FileInfo
	err := fs.WalkDir(client.StaticFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			info, err := d.Info()
			if err != nil {
				return err
			}
			fullPath := "static/" + path
			fileInfos = append(fileInfos, &staticFileInfo{
				fullPath: fullPath,
				info:     info,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return fileInfos, nil
}
