// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package databus

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wps"
)

const cgBase = "https://api.coingecko.com/api/v3"

// CoinGeckoIDs maps common token symbols to their CoinGecko IDs.
var CoinGeckoIDs = map[string]string{
	"ETH":    "ethereum",
	"WETH":   "ethereum",
	"WBTC":   "wrapped-bitcoin",
	"BTC":    "bitcoin",
	"USDC":   "usd-coin",
	"USDT":   "tether",
	"DAI":    "dai",
	"ARB":    "arbitrum",
	"GMX":    "gmx",
	"LINK":   "chainlink",
	"MAGIC":  "magic",
	"PENDLE": "pendle",
	"OP":     "optimism",
	"AVAX":   "avalanche-2",
	"SOL":    "solana",
	"BNB":    "binancecoin",
	"UNI":    "uniswap",
	"AAVE":   "aave",
	"CRV":    "curve-dao-token",
	"BAL":    "balancer",
	"MKR":    "maker",
	"SNX":    "synthetix-network-token",
	"LDO":    "lido-dao",
	"RPL":    "rocket-pool",
	"RDNT":   "radiant-capital",
}

// CgSimplePrice is a map of coingecko-id → {"usd": <price>}.
type CgSimplePrice map[string]struct {
	USD            float64 `json:"usd"`
	USD24hChange   float64 `json:"usd_24h_change"`
	USDMarketCap   float64 `json:"usd_market_cap"`
}

// GetSimplePrices fetches USD prices for the given token symbols.
func GetSimplePrices(ctx context.Context, symbols []string) (map[string]float64, error) {
	ids := symbolsToIDs(symbols)
	if len(ids) == 0 {
		return nil, nil
	}
	url := fmt.Sprintf(
		"%s/simple/price?ids=%s&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
		cgBase, strings.Join(ids, ","),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("coingecko HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var cgMap CgSimplePrice
	if err := json.Unmarshal(body, &cgMap); err != nil {
		return nil, fmt.Errorf("coingecko unmarshal: %w", err)
	}
	result := make(map[string]float64, len(symbols))
	for _, sym := range symbols {
		id, ok := CoinGeckoIDs[strings.ToUpper(sym)]
		if !ok {
			continue
		}
		if entry, found := cgMap[id]; found {
			result[sym] = entry.USD
		}
	}
	return result, nil
}

func symbolsToIDs(symbols []string) []string {
	seen := map[string]struct{}{}
	var ids []string
	for _, sym := range symbols {
		id, ok := CoinGeckoIDs[strings.ToUpper(sym)]
		if !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

// CoinGeckoTokenPriceData is the payload for the Event_PriceTicker WPS event
// when sourced from CoinGecko.
type CoinGeckoTokenPriceData struct {
	Symbol string  `json:"symbol"`
	Price  float64 `json:"price"`
	Source string  `json:"source"`
	Ts     int64   `json:"ts"`
}

// CoinGeckoFetcher periodically polls CoinGecko prices for a set of token
// symbols and publishes Event_PriceTicker events.
type CoinGeckoFetcher struct {
	// Symbols to track (e.g. ["ETH", "BTC", "ARB"]).
	Symbols  []string
	// Interval between polls.  CoinGecko free tier allows ~30 req/min.
	// Defaults to 60 s.
	Interval time.Duration
}

func (f *CoinGeckoFetcher) Name() string { return "coingecko" }

func (f *CoinGeckoFetcher) Start(ctx context.Context) {
	interval := f.Interval
	if interval <= 0 {
		interval = 60 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	// Fetch immediately on start
	f.fetchAndPublish(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			f.fetchAndPublish(ctx)
		}
	}
}

func (f *CoinGeckoFetcher) fetchAndPublish(ctx context.Context) {
	prices, err := GetSimplePrices(ctx, f.Symbols)
	if err != nil {
		log.Printf("[databus/coingecko] price error: %v", err)
		return
	}
	now := time.Now().UnixMilli()
	for sym, price := range prices {
		wps.Broker.Publish(wps.WaveEvent{
			Event:  wps.Event_PriceTicker,
			Scopes: []string{sym},
			Data: CoinGeckoTokenPriceData{
				Symbol: sym,
				Price:  price,
				Source: "coingecko",
				Ts:     now,
			},
		})
	}
}
