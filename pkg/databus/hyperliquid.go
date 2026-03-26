// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package databus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wps"
)

const (
	hlRestBase = "https://api.hyperliquid.xyz/info"
)

// ---- Shared types ----------------------------------------------------------

// OhlcvCandle is a single OHLCV candle from the Hyperliquid candleSnapshot API.
type OhlcvCandle struct {
	// OpenTime is the candle open time in milliseconds.
	OpenTime int64   `json:"t"`
	// CloseTime is the candle close time in milliseconds.
	CloseTime int64   `json:"T"`
	Symbol   string  `json:"s"`
	Interval string  `json:"i"`
	Open     string  `json:"o"`
	Close    string  `json:"c"`
	High     string  `json:"h"`
	Low      string  `json:"l"`
	Volume   string  `json:"v"`
	NumTrades int    `json:"n"`
}

// HyperliquidSymbol describes a single tradable perpetual asset.
type HyperliquidSymbol struct {
	Name        string `json:"name"`
	SzDecimals  int    `json:"szDecimals"`
	MaxLeverage int    `json:"maxLeverage"`
}

// PriceTickerData is the payload for the Event_PriceTicker WPS event.
type PriceTickerData struct {
	// Symbol is the Wave terminal symbol (e.g. "BTC-PERP").
	Symbol string `json:"symbol"`
	// Price is the current mid price.
	Price  float64 `json:"price"`
	// Source identifies the data provider.
	Source string  `json:"source"`
	// Ts is the server timestamp in milliseconds.
	Ts     int64   `json:"ts"`
}

// OhlcvUpdateData is the payload for the Event_OhlcvUpdate WPS event.
type OhlcvUpdateData struct {
	Symbol  string        `json:"symbol"`
	Candles []OhlcvCandle `json:"candles"`
}

// ---- Hyperliquid REST helper -----------------------------------------------

func hlPost(ctx context.Context, body any) ([]byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("hlPost marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hlRestBase, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hyperliquid HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// GetAllMids fetches the current mid prices for all perp symbols.
// Returns a map of coin → price string (e.g. "BTC" → "67450.0").
func GetAllMids(ctx context.Context) (map[string]string, error) {
	data, err := hlPost(ctx, map[string]string{"type": "allMids"})
	if err != nil {
		return nil, err
	}
	var result map[string]string
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("allMids unmarshal: %w", err)
	}
	return result, nil
}

// GetMeta fetches metadata for all tradable perp assets.
func GetMeta(ctx context.Context) ([]HyperliquidSymbol, error) {
	data, err := hlPost(ctx, map[string]string{"type": "meta"})
	if err != nil {
		return nil, err
	}
	var wrapper struct {
		Universe []HyperliquidSymbol `json:"universe"`
	}
	if err := json.Unmarshal(data, &wrapper); err != nil {
		return nil, fmt.Errorf("meta unmarshal: %w", err)
	}
	return wrapper.Universe, nil
}

// GetCandles fetches OHLCV candles for a single coin.
func GetCandles(ctx context.Context, coin, resolution string, startTime, endTime int64) ([]OhlcvCandle, error) {
	body := map[string]any{
		"type": "candleSnapshot",
		"req": map[string]any{
			"coin":       coin,
			"resolution": resolution,
			"startTime":  startTime,
			"endTime":    endTime,
		},
	}
	data, err := hlPost(ctx, body)
	if err != nil {
		return nil, err
	}
	var candles []OhlcvCandle
	if err := json.Unmarshal(data, &candles); err != nil {
		return nil, fmt.Errorf("candles unmarshal: %w", err)
	}
	return candles, nil
}

// ---- HyperliquidFetcher (implements Fetcher) --------------------------------

// HyperliquidFetcher periodically polls allMids and publishes
// Event_PriceTicker events on the WPS broker.
type HyperliquidFetcher struct {
	// Symbols is the list of perp symbols to track (e.g. "BTC-PERP").
	// If empty, all available symbols are tracked.
	Symbols  []string
	// Interval is how often mid prices are polled.  Defaults to 5 s.
	Interval time.Duration
}

func (f *HyperliquidFetcher) Name() string { return "hyperliquid" }

func (f *HyperliquidFetcher) Start(ctx context.Context) {
	interval := f.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			f.fetchAndPublish(ctx)
		}
	}
}

func (f *HyperliquidFetcher) fetchAndPublish(ctx context.Context) {
	mids, err := GetAllMids(ctx)
	if err != nil {
		log.Printf("[databus/hyperliquid] allMids error: %v", err)
		return
	}
	now := time.Now().UnixMilli()
	for coin, priceStr := range mids {
		var price float64
		if _, err := fmt.Sscanf(priceStr, "%f", &price); err != nil {
			continue
		}
		sym := coin + "-PERP"
		if len(f.Symbols) > 0 && !containsStr(f.Symbols, sym) {
			continue
		}
		wps.Broker.Publish(wps.WaveEvent{
			Event:  wps.Event_PriceTicker,
			Scopes: []string{sym},
			Data: PriceTickerData{
				Symbol: sym,
				Price:  price,
				Source: "hyperliquid",
				Ts:     now,
			},
		})
	}
}

func containsStr(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}
