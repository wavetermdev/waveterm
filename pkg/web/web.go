// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/docsite"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/service"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type WebFnType = func(http.ResponseWriter, *http.Request)

const TransparentGif64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

// Header constants
const (
	CacheControlHeaderKey     = "Cache-Control"
	CacheControlHeaderNoCache = "no-cache"

	ContentTypeHeaderKey = "Content-Type"
	ContentTypeJson      = "application/json"
	ContentTypeBinary    = "application/octet-stream"

	ContentLengthHeaderKey = "Content-Length"
	LastModifiedHeaderKey  = "Last-Modified"

	WaveZoneFileInfoHeaderKey = "X-ZoneFileInfo"
)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

type WebFnOpts struct {
	AllowCaching bool
	JsonErrors   bool
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

type notFoundBlockingResponseWriter struct {
	w       http.ResponseWriter
	status  int
	headers http.Header
}

func (rw *notFoundBlockingResponseWriter) Header() http.Header {
	return rw.headers
}

func (rw *notFoundBlockingResponseWriter) WriteHeader(status int) {
	if status == http.StatusNotFound {
		rw.status = status
		return
	}
	rw.status = status
	copyHeaders(rw.w.Header(), rw.headers)
	rw.w.WriteHeader(status)
}

func (rw *notFoundBlockingResponseWriter) Write(b []byte) (int, error) {
	if rw.status == http.StatusNotFound {
		// Block the write if it's a 404
		return len(b), nil
	}
	if rw.status == 0 {
		rw.WriteHeader(http.StatusOK)
	}
	return rw.w.Write(b)
}

func handleService(w http.ResponseWriter, r *http.Request) {
	bodyData, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Unable to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}
	var webCall service.WebCallType
	err = json.Unmarshal(bodyData, &webCall)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
	}

	rtn := service.CallService(r.Context(), webCall)
	jsonRtn, err := json.Marshal(rtn)
	if err != nil {
		http.Error(w, fmt.Sprintf("error serializing response: %v", err), http.StatusInternalServerError)
	}
	w.Header().Set(ContentTypeHeaderKey, ContentTypeJson)
	w.Header().Set(ContentLengthHeaderKey, fmt.Sprintf("%d", len(jsonRtn)))
	w.WriteHeader(http.StatusOK)
	w.Write(jsonRtn)
}

func marshalReturnValue(data any, err error) []byte {
	var mapRtn = make(map[string]any)
	if err != nil {
		mapRtn["error"] = err.Error()
	} else {
		mapRtn["success"] = true
		mapRtn["data"] = data
	}
	rtn, err := json.Marshal(mapRtn)
	if err != nil {
		return marshalReturnValue(nil, fmt.Errorf("error serializing response: %v", err))
	}
	return rtn
}

func handleWaveFile(w http.ResponseWriter, r *http.Request) {
	zoneId := r.URL.Query().Get("zoneid")
	name := r.URL.Query().Get("name")
	offsetStr := r.URL.Query().Get("offset")
	var offset int64 = 0
	if offsetStr != "" {
		var err error
		offset, err = strconv.ParseInt(offsetStr, 10, 64)
		if err != nil {
			http.Error(w, fmt.Sprintf("invalid offset: %v", err), http.StatusBadRequest)
		}
	}
	if _, err := uuid.Parse(zoneId); err != nil {
		http.Error(w, fmt.Sprintf("invalid zoneid: %v", err), http.StatusBadRequest)
		return
	}
	if name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return

	}
	file, err := filestore.WFS.Stat(r.Context(), zoneId, name)
	if err == fs.ErrNotExist {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("error getting file info: %v", err), http.StatusInternalServerError)
		return
	}
	jsonFileBArr, err := json.Marshal(file)
	if err != nil {
		http.Error(w, fmt.Sprintf("error serializing file info: %v", err), http.StatusInternalServerError)
	}
	// can make more efficient by checking modtime + If-Modified-Since headers to allow caching
	dataStartIdx := file.DataStartIdx()
	if offset >= dataStartIdx {
		dataStartIdx = offset
	}
	w.Header().Set(ContentTypeHeaderKey, ContentTypeBinary)
	w.Header().Set(ContentLengthHeaderKey, fmt.Sprintf("%d", file.Size-dataStartIdx))
	w.Header().Set(WaveZoneFileInfoHeaderKey, base64.StdEncoding.EncodeToString(jsonFileBArr))
	w.Header().Set(LastModifiedHeaderKey, time.UnixMilli(file.ModTs).UTC().Format(http.TimeFormat))
	if dataStartIdx >= file.Size {
		w.WriteHeader(http.StatusOK)
		return
	}
	for offset := dataStartIdx; offset < file.Size; offset += filestore.DefaultPartDataSize {
		_, data, err := filestore.WFS.ReadAt(r.Context(), zoneId, name, offset, filestore.DefaultPartDataSize)
		if err != nil {
			if offset == 0 {
				http.Error(w, fmt.Sprintf("error reading file: %v", err), http.StatusInternalServerError)
			} else {
				// nothing to do, the headers have already been sent
				log.Printf("error reading file %s/%s @ %d: %v\n", zoneId, name, offset, err)
			}
			return
		}
		w.Write(data)
	}
}

func serveTransparentGIF(w http.ResponseWriter) {
	gifBytes, _ := base64.StdEncoding.DecodeString(TransparentGif64)
	w.Header().Set("Content-Type", "image/gif")
	w.WriteHeader(http.StatusOK)
	w.Write(gifBytes)
}

func handleLocalStreamFile(w http.ResponseWriter, r *http.Request, path string, no404 bool) {
	if no404 {
		log.Printf("streaming file w/no404: %q\n", path)
		// use the custom response writer
		rw := &notFoundBlockingResponseWriter{w: w, headers: http.Header{}}

		// Serve the file using http.ServeFile
		path, err := wavebase.ExpandHomeDir(path)
		if err == nil {
			http.ServeFile(rw, r, filepath.Clean(path))
			// if the file was not found, serve the transparent GIF
			log.Printf("got streamfile status: %d\n", rw.status)
			if rw.status == http.StatusNotFound {
				serveTransparentGIF(w)
			}
		} else {
			serveTransparentGIF(w)
		}
	} else {
		path, err := wavebase.ExpandHomeDir(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		http.ServeFile(w, r, path)
	}
}

func handleRemoteStreamFile(w http.ResponseWriter, r *http.Request, conn string, path string, no404 bool) error {
	client := wshserver.GetMainRpcClient()
	streamFileData := wshrpc.CommandRemoteStreamFileData{Path: path}
	route := wshutil.MakeConnectionRouteId(conn)
	rtnCh := wshclient.RemoteStreamFileCommand(client, streamFileData, &wshrpc.RpcOpts{Route: route})
	firstPk := true
	var fileInfo *wshrpc.FileInfo
	loopDone := false
	defer func() {
		if loopDone {
			return
		}
		// if loop didn't finish naturally clear it out
		go func() {
			for range rtnCh {
			}
		}()
	}()
	for respUnion := range rtnCh {
		if respUnion.Error != nil {
			return respUnion.Error
		}
		if firstPk {
			firstPk = false
			if len(respUnion.Response.FileInfo) != 1 {
				return fmt.Errorf("stream file protocol error, first pk fileinfo len=%d", len(respUnion.Response.FileInfo))
			}
			fileInfo = respUnion.Response.FileInfo[0]
			if fileInfo.NotFound {
				if no404 {
					serveTransparentGIF(w)
					return nil
				} else {
					return fmt.Errorf("file not found: %q", path)
				}
			}
			if fileInfo.IsDir {
				return fmt.Errorf("cannot stream directory: %q", path)
			}
			w.Header().Set(ContentTypeHeaderKey, fileInfo.MimeType)
			w.Header().Set(ContentLengthHeaderKey, fmt.Sprintf("%d", fileInfo.Size))
			continue
		}
		if respUnion.Response.Data64 == "" {
			continue
		}
		decoder := base64.NewDecoder(base64.StdEncoding, bytes.NewReader([]byte(respUnion.Response.Data64)))
		_, err := io.Copy(w, decoder)
		if err != nil {
			log.Printf("error streaming file %q: %v\n", path, err)
			// not sure what to do here, the headers have already been sent.
			// just return
			return nil
		}
	}
	loopDone = true
	return nil
}

func handleStreamFile(w http.ResponseWriter, r *http.Request) {
	conn := r.URL.Query().Get("connection")
	if conn == "" {
		conn = wshrpc.LocalConnName
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	no404 := r.URL.Query().Get("no404")
	if conn == wshrpc.LocalConnName {
		handleLocalStreamFile(w, r, path, no404 != "")
	} else {
		err := handleRemoteStreamFile(w, r, conn, path, no404 != "")
		if err != nil {
			log.Printf("error streaming remote file %q %q: %v\n", conn, path, err)
			http.Error(w, fmt.Sprintf("error streaming file: %v", err), http.StatusInternalServerError)
		}
	}
}

func WriteJsonError(w http.ResponseWriter, errVal error) {
	w.Header().Set(ContentTypeHeaderKey, ContentTypeJson)
	w.WriteHeader(http.StatusOK)
	errMap := make(map[string]interface{})
	errMap["error"] = errVal.Error()
	barr, _ := json.Marshal(errMap)
	w.Write(barr)
}

func WriteJsonSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set(ContentTypeHeaderKey, ContentTypeJson)
	rtnMap := make(map[string]interface{})
	rtnMap["success"] = true
	if data != nil {
		rtnMap["data"] = data
	}
	barr, err := json.Marshal(rtnMap)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write(barr)
}

type ClientActiveState struct {
	Fg     bool `json:"fg"`
	Active bool `json:"active"`
	Open   bool `json:"open"`
}

// params: fg, active, open
func handleLogActiveState(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)
	var activeState ClientActiveState
	err := decoder.Decode(&activeState)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %v", err))
		return
	}
	activity := telemetry.ActivityUpdate{}
	if activeState.Fg {
		activity.FgMinutes = 1
	}
	if activeState.Active {
		activity.ActiveMinutes = 1
	}
	if activeState.Open {
		activity.OpenMinutes = 1
	}
	activity.NumTabs, _ = wstore.DBGetCount[*waveobj.Tab](r.Context())
	err = telemetry.UpdateActivity(r.Context(), activity)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error updating activity: %w", err))
		return
	}
	WriteJsonSuccess(w, true)
}

func WebFnWrap(opts WebFnOpts, fn WebFnType) WebFnType {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			recErr := recover()
			if recErr == nil {
				return
			}
			panicStr := fmt.Sprintf("panic: %v", recErr)
			log.Printf("panic: %v\n", recErr)
			debug.PrintStack()
			if opts.JsonErrors {
				jsonRtn := marshalReturnValue(nil, fmt.Errorf(panicStr))
				w.Header().Set(ContentTypeHeaderKey, ContentTypeJson)
				w.Header().Set(ContentLengthHeaderKey, fmt.Sprintf("%d", len(jsonRtn)))
				w.WriteHeader(http.StatusOK)
				w.Write(jsonRtn)
			} else {
				http.Error(w, panicStr, http.StatusInternalServerError)
			}
		}()
		if !opts.AllowCaching {
			w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
		}
		w.Header().Set("Access-Control-Expose-Headers", "X-ZoneFileInfo")
		err := authkey.ValidateIncomingRequest(r)
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(fmt.Sprintf("error validating authkey: %v", err)))
			return
		}
		fn(w, r)
	}
}

func MakeTCPListener(serviceName string) (net.Listener, error) {
	serverAddr := "127.0.0.1:"
	rtn, err := net.Listen("tcp", serverAddr)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", serverAddr, err)
	}
	log.Printf("Server [%s] listening on %s\n", serviceName, rtn.Addr())
	return rtn, nil
}

func MakeUnixListener() (net.Listener, error) {
	serverAddr := wavebase.GetWaveDataDir() + "/wave.sock"
	os.Remove(serverAddr) // ignore error
	rtn, err := net.Listen("unix", serverAddr)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", serverAddr, err)
	}
	os.Chmod(serverAddr, 0700)
	log.Printf("Server [unix-domain] listening on %s\n", serverAddr)
	return rtn, nil
}

const docsitePrefix = "/docsite/"

// blocking
func RunWebServer(listener net.Listener) {
	gr := mux.NewRouter()
	gr.HandleFunc("/wave/stream-file", WebFnWrap(WebFnOpts{AllowCaching: true}, handleStreamFile))
	gr.HandleFunc("/wave/file", WebFnWrap(WebFnOpts{AllowCaching: false}, handleWaveFile))
	gr.HandleFunc("/wave/service", WebFnWrap(WebFnOpts{JsonErrors: true}, handleService))
	gr.HandleFunc("/wave/log-active-state", WebFnWrap(WebFnOpts{JsonErrors: true}, handleLogActiveState))
	gr.PathPrefix(docsitePrefix).Handler(http.StripPrefix(docsitePrefix, docsite.GetDocsiteHandler()))
	handler := http.TimeoutHandler(gr, HttpTimeoutDuration, "Timeout")
	if wavebase.IsDevMode() {
		handler = handlers.CORS(handlers.AllowedOrigins([]string{"*"}))(handler)
	}
	server := &http.Server{
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        handler,
	}
	err := server.Serve(listener)
	if err != nil {
		log.Printf("ERROR: %v\n", err)
	}
}
