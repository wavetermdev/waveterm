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

func SendTelemetry(ctx context.Context, clientId string) error {
	if !telemetry.IsTelemetryEnabled() {
		log.Printf("telemetry disabled, not sending\n")
		return nil
	}
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
