// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// Add the new handler function
func handleVDom(w http.ResponseWriter, r *http.Request) {
	// Extract UUID and path from URL
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/vdom/"), "/")
	if len(pathParts) < 1 {
		http.Error(w, "Invalid VDOM URL format", http.StatusBadRequest)
		return
	}

	uuid := pathParts[0]
	// Simple UUID validation
	if len(uuid) != 36 {
		http.Error(w, "Invalid UUID format", http.StatusBadRequest)
		return
	}

	// Reconstruct the remaining path
	path := "/" + strings.Join(pathParts[1:], "/")
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}

	// Read request body if present
	var body []byte
	var err error
	if r.Body != nil {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, fmt.Sprintf("Error reading request body: %v", err), http.StatusInternalServerError)
			return
		}
		defer r.Body.Close()
	}

	// Convert headers to map
	headers := make(map[string]string)
	for key, values := range r.Header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}

	// Prepare RPC request data
	data := wshrpc.VDomUrlRequestData{
		Method:  r.Method,
		URL:     path,
		Headers: headers,
		Body:    body,
	}

	// Get RPC client
	client := wshserver.GetMainRpcClient()

	// Make RPC call with route to specific process
	route := wshutil.MakeProcRouteId(uuid)
	respCh := wshclient.VDomUrlRequestCommand(client, data, &wshrpc.RpcOpts{
		Route: route,
	})

	// Handle first response to set headers
	firstResp := true
	for respUnion := range respCh {
		if respUnion.Error != nil {
			http.Error(w, fmt.Sprintf("RPC error: %v", respUnion.Error), http.StatusInternalServerError)
			return
		}

		resp := respUnion.Response
		if firstResp {
			firstResp = false
			// Set status code and headers from first response
			if resp.StatusCode > 0 {
				w.WriteHeader(resp.StatusCode)
			} else {
				w.WriteHeader(http.StatusOK)
			}
			// Copy headers
			for key, value := range resp.Headers {
				w.Header().Set(key, value)
			}
		}

		// Write body chunk if present
		if len(resp.Body) > 0 {
			_, err = w.Write(resp.Body)
			if err != nil {
				log.Printf("Error writing response: %v", err)
				return
			}
		}
	}
}
