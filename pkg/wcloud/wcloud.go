// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/daystr"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const WCloudEndpoint = "https://api.waveterm.dev/central"
const WCloudEndpointVarName = "WCLOUD_ENDPOINT"
const WCloudWSEndpoint = "wss://wsapi.waveterm.dev/"
const WCloudWSEndpointVarName = "WCLOUD_WS_ENDPOINT"

var WCloudWSEndpoint_VarCache string
var WCloudEndpoint_VarCache string

const APIVersion = 1
const MaxPtyUpdateSize = (128 * 1024)
const MaxUpdatesPerReq = 10
const MaxUpdatesToDeDup = 1000
const MaxUpdateWriterErrors = 3
const WCloudDefaultTimeout = 5 * time.Second
const WCloudWebShareUpdateTimeout = 15 * time.Second

// setting to 1M to be safe (max is 6M for API-GW + Lambda, but there is base64 encoding and upload time)
// we allow one extra update past this estimated size
const MaxUpdatePayloadSize = 1 * (1024 * 1024)

const TelemetryUrl = "/telemetry"
const TEventsUrl = "/tevents"
const NoTelemetryUrl = "/no-telemetry"
const WebShareUpdateUrl = "/auth/web-share-update"

func CacheAndRemoveEnvVars() error {
	WCloudEndpoint_VarCache = os.Getenv(WCloudEndpointVarName)
	err := checkEndpointVar(WCloudEndpoint_VarCache, "wcloud endpoint", WCloudEndpointVarName)
	if err != nil {
		return err
	}
	os.Unsetenv(WCloudEndpointVarName)
	WCloudWSEndpoint_VarCache = os.Getenv(WCloudWSEndpointVarName)
	err = checkWSEndpointVar(WCloudWSEndpoint_VarCache, "wcloud ws endpoint", WCloudWSEndpointVarName)
	if err != nil {
		return err
	}
	os.Unsetenv(WCloudWSEndpointVarName)
	return nil
}

func checkEndpointVar(endpoint string, debugName string, varName string) error {
	if !wavebase.IsDevMode() {
		return nil
	}
	if endpoint == "" || !strings.HasPrefix(endpoint, "https://") {
		return fmt.Errorf("invalid %s, %s not set or invalid", debugName, varName)
	}
	return nil
}

func checkWSEndpointVar(endpoint string, debugName string, varName string) error {
	if !wavebase.IsDevMode() {
		return nil
	}
	log.Printf("checking endpoint %q\n", endpoint)
	if endpoint == "" || !strings.HasPrefix(endpoint, "wss://") {
		return fmt.Errorf("invalid %s, %s not set or invalid", debugName, varName)
	}
	return nil
}

func GetEndpoint() string {
	if !wavebase.IsDevMode() {
		return WCloudEndpoint
	}
	endpoint := WCloudEndpoint_VarCache
	return endpoint
}

func GetWSEndpoint() string {
	if !wavebase.IsDevMode() {
		return WCloudWSEndpoint
	}
	endpoint := WCloudWSEndpoint_VarCache
	return endpoint
}

func makeAnonPostReq(ctx context.Context, apiUrl string, data interface{}) (*http.Request, error) {
	endpoint := GetEndpoint()
	if endpoint == "" {
		return nil, errors.New("wcloud endpoint not set")
	}
	var dataReader io.Reader
	if data != nil {
		byteArr, err := json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("error marshaling json for %s request: %v", apiUrl, err)
		}
		dataReader = bytes.NewReader(byteArr)
	}
	fullUrl := GetEndpoint() + apiUrl
	req, err := http.NewRequestWithContext(ctx, "POST", fullUrl, dataReader)
	if err != nil {
		return nil, fmt.Errorf("error creating %s request: %v", apiUrl, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-PromptAPIVersion", strconv.Itoa(APIVersion))
	req.Header.Set("X-PromptAPIUrl", apiUrl)
	req.Close = true
	return req, nil
}

func doRequest(req *http.Request, outputObj interface{}) (*http.Response, error) {
	apiUrl := req.Header.Get("X-PromptAPIUrl")
	log.Printf("[wcloud] sending request %s %v\n", req.Method, req.URL)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error contacting wcloud %q service: %v", apiUrl, err)
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, fmt.Errorf("error reading %q response body: %v", apiUrl, err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, fmt.Errorf("error contacting wcloud %q service: %s", apiUrl, resp.Status)
	}
	if outputObj != nil && resp.Header.Get("Content-Type") == "application/json" {
		err = json.Unmarshal(bodyBytes, outputObj)
		if err != nil {
			return resp, fmt.Errorf("error decoding json: %v", err)
		}
	}
	return resp, nil
}

type TEventsInputType struct {
	ClientId string                  `json:"clientid"`
	Events   []*telemetrydata.TEvent `json:"events"`
}

const TEventsBatchSize = 200
const TEventsMaxBatches = 10

// returns (done, num-sent, error)
func sendTEventsBatch(clientId string) (bool, int, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), WCloudDefaultTimeout)
	defer cancelFn()
	events, err := telemetry.GetNonUploadedTEvents(ctx, TEventsBatchSize)
	if err != nil {
		return true, 0, fmt.Errorf("cannot get events: %v", err)
	}
	if len(events) == 0 {
		return true, 0, nil
	}
	input := TEventsInputType{
		ClientId: clientId,
		Events:   events,
	}
	req, err := makeAnonPostReq(ctx, TEventsUrl, input)
	if err != nil {
		return true, 0, err
	}
	startTime := time.Now()
	_, err = doRequest(req, nil)
	latency := time.Since(startTime)
	log.Printf("[wcloud] sent %d tevents (latency: %v)\n", len(events), latency)
	if err != nil {
		return true, 0, err
	}
	err = telemetry.MarkTEventsAsUploaded(ctx, events)
	if err != nil {
		return true, 0, fmt.Errorf("error marking activity as uploaded: %v", err)
	}
	return len(events) < TEventsBatchSize, len(events), nil
}

func sendTEvents(clientId string) (int, error) {
	numIters := 0
	totalEvents := 0
	for {
		numIters++
		done, numEvents, err := sendTEventsBatch(clientId)
		if err != nil {
			log.Printf("error sending telemetry events: %v\n", err)
			break
		}
		totalEvents += numEvents
		if done {
			break
		}
		if numIters > TEventsMaxBatches {
			log.Printf("sendTEvents, hit %d iterations, stopping\n", numIters)
			break
		}
	}
	return totalEvents, nil
}

func SendAllTelemetry(clientId string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	if err := telemetry.CleanOldTEvents(ctx); err != nil {
		log.Printf("error cleaning old telemetry events: %v\n", err)
	}
	if !telemetry.IsTelemetryEnabled() {
		log.Printf("telemetry disabled, not sending\n")
		return nil
	}
	_, err := sendTEvents(clientId)
	if err != nil {
		return err
	}
	return nil
}

func sendTelemetry(clientId string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), WCloudDefaultTimeout)
	defer cancelFn()
	activity, err := telemetry.GetNonUploadedActivity(ctx)
	if err != nil {
		return fmt.Errorf("cannot get activity: %v", err)
	}
	if len(activity) == 0 {
		return nil
	}
	log.Printf("[wcloud] sending telemetry data\n")
	dayStr := daystr.GetCurDayStr()
	input := TelemetryInputType{
		ClientId:          clientId,
		UserId:            clientId,
		AppType:           "w2",
		AutoUpdateEnabled: telemetry.IsAutoUpdateEnabled(),
		AutoUpdateChannel: telemetry.AutoUpdateChannel(),
		CurDay:            dayStr,
		Activity:          activity,
	}
	req, err := makeAnonPostReq(ctx, TelemetryUrl, input)
	if err != nil {
		return err
	}
	_, err = doRequest(req, nil)
	if err != nil {
		return err
	}
	err = telemetry.MarkActivityAsUploaded(ctx, activity)
	if err != nil {
		return fmt.Errorf("error marking activity as uploaded: %v", err)
	}
	return nil
}

func SendNoTelemetryUpdate(ctx context.Context, clientId string, noTelemetryVal bool) error {
	req, err := makeAnonPostReq(ctx, NoTelemetryUrl, NoTelemetryInputType{ClientId: clientId, Value: noTelemetryVal})
	if err != nil {
		return err
	}
	_, err = doRequest(req, nil)
	if err != nil {
		return err
	}
	return nil
}
