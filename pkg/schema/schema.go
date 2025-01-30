// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package schema

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

var schemaHandler http.Handler

func GetSchemaHandler() http.Handler {
	schemaStaticPath := filepath.Join(wavebase.GetWaveAppPath(), "schema")
	stat, err := os.Stat(schemaStaticPath)
	if schemaHandler == nil {
		log.Println("Schema is nil, initializing")
		if err == nil && stat.IsDir() {
			log.Printf("Found static site at %s, serving\n", schemaStaticPath)
			schemaHandler = http.FileServer(JsonDir{http.Dir(schemaStaticPath)})
		} else {
			log.Printf("Did not find static site at %s, serving not found handler. stat: %v, err: %v\n", schemaStaticPath, stat, err)
			schemaHandler = http.NotFoundHandler()
		}
	}
	return addHeaders(schemaHandler)
}

func addHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Content-Type", "application/schema+json")
		next.ServeHTTP(w, r)
	})
}

type JsonDir struct {
	d http.Dir
}

func (d JsonDir) Open(name string) (http.File, error) {
	// Try name as supplied
	f, err := d.d.Open(name)
	if os.IsNotExist(err) {
		// Not found, try with .json
		if f, err := d.d.Open(name + ".json"); err == nil {
			return f, nil
		}
	}
	return f, err
}
