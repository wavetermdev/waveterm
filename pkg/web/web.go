// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/service"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

type WebFnType = func(http.ResponseWriter, *http.Request)

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

const MainServerAddr = "127.0.0.1:1719"      // wavesrv,  P=16+1, S=19, PS=1719
const WebSocketServerAddr = "127.0.0.1:1723" // wavesrv:websocket, P=16+1, W=23, PW=1723
const MainServerDevAddr = "127.0.0.1:8190"
const WebSocketServerDevAddr = "127.0.0.1:8191"
const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

type WebFnOpts struct {
	AllowCaching bool
	JsonErrors   bool
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

func handleStreamFile(w http.ResponseWriter, r *http.Request) {
	fileName := r.URL.Query().Get("path")
	if fileName == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	fileName = wavebase.ExpandHomeDir(fileName)
	http.ServeFile(w, r, fileName)
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
		// reqAuthKey := r.Header.Get("X-AuthKey")
		// if reqAuthKey == "" {
		// 	w.WriteHeader(http.StatusInternalServerError)
		// 	w.Write([]byte("no x-authkey header"))
		// 	return
		// }
		// if reqAuthKey != scbase.WaveAuthKey {
		// 	w.WriteHeader(http.StatusInternalServerError)
		// 	w.Write([]byte("x-authkey header is invalid"))
		// 	return
		// }
		fn(w, r)
	}
}

func MakeTCPListener() (net.Listener, error) {
	serverAddr := MainServerAddr
	if wavebase.IsDevMode() {
		serverAddr = MainServerDevAddr
	}
	rtn, err := net.Listen("tcp", serverAddr)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", serverAddr, err)
	}
	log.Printf("Server listening on %s\n", serverAddr)
	return rtn, nil
}

func MakeUnixListener() (net.Listener, error) {
	serverAddr := wavebase.GetWaveHomeDir() + "/wave.sock"
	os.Remove(serverAddr) // ignore error
	rtn, err := net.Listen("unix", serverAddr)
	if err != nil {
		return nil, fmt.Errorf("error creating listener at %v: %v", serverAddr, err)
	}
	os.Chmod(serverAddr, 0700)
	log.Printf("Server listening on %s\n", serverAddr)
	return rtn, nil
}

// blocking
func RunWebServer(listener net.Listener) {
	gr := mux.NewRouter()
	gr.HandleFunc("/wave/stream-file", WebFnWrap(WebFnOpts{AllowCaching: true}, handleStreamFile))
	gr.HandleFunc("/wave/file", WebFnWrap(WebFnOpts{AllowCaching: false}, handleWaveFile))
	gr.HandleFunc("/wave/service", WebFnWrap(WebFnOpts{JsonErrors: true}, handleService))
	var allowedOrigins handlers.CORSOption
	if wavebase.IsDevMode() {
		allowedOrigins = handlers.AllowedOrigins([]string{"*"})
	}
	server := &http.Server{
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        handlers.CORS(allowedOrigins)(http.TimeoutHandler(gr, HttpTimeoutDuration, "Timeout")),
	}
	err := server.Serve(listener)
	if err != nil {
		log.Printf("ERROR: %v\n", err)
	}
}
