// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package faviconcache

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// --- Constants and Types ---

// cacheDuration is how long a cached entry is considered “fresh.”
const cacheDuration = 24 * time.Hour

// maxIconSize limits the favicon size to 256 KB.
const maxIconSize = 256 * 1024 // in bytes

// FaviconCacheItem represents one cached favicon entry.
type FaviconCacheItem struct {
	// Data is the base64-encoded data URL string (e.g. "data:image/png;base64,...")
	Data string
	// LastFetched is when this entry was last updated.
	LastFetched time.Time
}

// --- Global variables for managing in-flight fetches ---
// We use a mutex and a simple map to prevent multiple simultaneous fetches for the same domain.
var (
	fetchLock sync.Mutex
	fetching  = make(map[string]bool)
)

// Use a semaphore (buffered channel) to limit concurrent fetches to 5.
var fetchSemaphore = make(chan bool, 5)

var (
	faviconCacheLock sync.Mutex
	faviconCache     = make(map[string]*FaviconCacheItem)
)

// --- GetFavicon ---
//
// GetFavicon takes a URL string and returns a base64-encoded src URL for an <img>
// tag. If the favicon is already in cache and “fresh,” it returns it immediately.
// Otherwise it kicks off a background fetch (if one isn’t already in progress)
// and returns whatever is in the cache (which may be empty).
func GetFavicon(urlStr string) string {
	// Parse the URL and extract the domain.
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		log.Printf("GetFavicon: invalid URL %q: %v", urlStr, err)
		return ""
	}
	domain := parsedURL.Hostname()
	if domain == "" {
		log.Printf("GetFavicon: no hostname found in URL %q", urlStr)
		return ""
	}

	// Try to get from our cache.
	item, found := GetFromCache(domain)
	if found {
		// If the cached entry is not stale, return it.
		if time.Since(item.LastFetched) < cacheDuration {
			return item.Data
		}
	}

	// Either the item was not found or it’s stale:
	// Launch an async fetch if one isn’t already running for this domain.
	triggerAsyncFetch(domain)

	// Return the cached value (even if stale or empty).
	return item.Data
}

// triggerAsyncFetch starts a goroutine to update the favicon cache
// for the given domain if one isn’t already in progress.
func triggerAsyncFetch(domain string) {
	fetchLock.Lock()
	if fetching[domain] {
		// Already fetching this domain; nothing to do.
		fetchLock.Unlock()
		return
	}
	// Mark this domain as in-flight.
	fetching[domain] = true
	fetchLock.Unlock()

	go func() {
		defer func() {
			panichandler.PanicHandler("Favicon:triggerAsyncFetch", recover())
		}()

		// Acquire a slot in the semaphore.
		fetchSemaphore <- true

		// When done, ensure that we clear the “fetching” flag.
		defer func() {
			<-fetchSemaphore
			fetchLock.Lock()
			delete(fetching, domain)
			fetchLock.Unlock()
		}()

		iconStr, err := fetchFavicon(domain)
		if err != nil {
			log.Printf("triggerAsyncFetch: error fetching favicon for %s: %v", domain, err)
		}
		SetInCache(domain, FaviconCacheItem{Data: iconStr, LastFetched: time.Now()})
	}()
}

func fetchFavicon(domain string) (string, error) {
	// Create a context that times out after 5 seconds.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Special case for github.com - use their dark favicon from assets domain
	url := "https://" + domain + "/favicon.ico"
	if domain == "github.com" {
		url = "https://github.githubassets.com/favicons/favicon-dark.png"
	}

	// Create a new HTTP request with the context.
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("error creating request for %s: %w", url, err)
	}

	// Execute the HTTP request.
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("error fetching favicon from %s: %w", url, err)
	}
	defer resp.Body.Close()

	// Ensure we got a 200 OK.
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("non-OK HTTP status: %d fetching %s", resp.StatusCode, url)
	}

	// Read the favicon bytes.
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading favicon data from %s: %w", url, err)
	}

	// Encode the image bytes to base64.
	b64Data := base64.StdEncoding.EncodeToString(data)
	if len(b64Data) > maxIconSize {
		return "", fmt.Errorf("favicon too large: %d bytes", len(b64Data))
	}

	// Try to detect MIME type from Content-Type header first
	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		// If no Content-Type header, detect from content
		mimeType = http.DetectContentType(data)
	}

	if !strings.HasPrefix(mimeType, "image/") {
		return "", fmt.Errorf("unexpected MIME type: %s", mimeType)
	}

	return "data:" + mimeType + ";base64," + b64Data, nil
}

// TODO store in blockstore

func GetFromCache(key string) (FaviconCacheItem, bool) {
	faviconCacheLock.Lock()
	defer faviconCacheLock.Unlock()
	item, found := faviconCache[key]
	if !found {
		return FaviconCacheItem{}, false
	}
	return *item, true
}

func SetInCache(key string, item FaviconCacheItem) {
	faviconCacheLock.Lock()
	defer faviconCacheLock.Unlock()
	faviconCache[key] = &item
}
