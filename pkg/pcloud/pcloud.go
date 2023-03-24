package pcloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const PCloudEndpoint = "https://api.getprompt.dev/central"
const PCloudEndpointVarName = "PCLOUD_ENDPOINT"
const APIVersion = 1

const TelemetryUrl = "/telemetry"
const NoTelemetryUrl = "/no-telemetry"
const CreateCloudSessionUrl = "/auth/create-cloud-session"

type NoTelemetryInputType struct {
	ClientId string `json:"clientid"`
	Value    bool   `json:"value"`
}

type TelemetryInputType struct {
	UserId   string                 `json:"userid"`
	ClientId string                 `json:"clientid"`
	CurDay   string                 `json:"curday"`
	Activity []*sstore.ActivityType `json:"activity"`
}

type CloudSession struct {
	SessionId string `json:"sessionid"`
	ViewKey   string `json:"viewkey"`
	WriteKey  string `json:"writekey"`
	EncType   string `json:"enctype"`
	UpdateVTS int64  `json:"updatevts"`

	EncSessionData []byte `json:"enc_sessiondata" enc:"*"`
	Name           string `json:"-" enc:"name"`
}

func (cs *CloudSession) GetOData() string {
	return fmt.Sprintf("session:%s", cs.SessionId)
}

type AuthInfo struct {
	UserId   string `json:"userid"`
	ClientId string `json:"clientid"`
	AuthKey  string `json:"authkey"`
}

func GetEndpoint() string {
	if !scbase.IsDevMode() {
		return PCloudEndpoint
	}
	endpoint := os.Getenv(PCloudEndpointVarName)
	if endpoint == "" || !strings.HasPrefix(endpoint, "https://") {
		panic("Invalid PCloud dev endpoint, PCLOUD_ENDPOINT not set or invalid")
	}
	return endpoint
}

func makeAuthPostReq(ctx context.Context, apiUrl string, authInfo AuthInfo, data interface{}) (*http.Request, error) {
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
	req.Header.Set("X-PromptUserId", authInfo.UserId)
	req.Header.Set("X-PromptClientId", authInfo.ClientId)
	req.Header.Set("X-PromptAuthKey", authInfo.AuthKey)
	req.Close = true
	return req, nil
}

func makeAnonPostReq(ctx context.Context, apiUrl string, data interface{}) (*http.Request, error) {
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
	log.Printf("sending request %v\n", req.URL)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error contacting pcloud %q service: %v", apiUrl, err)
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, fmt.Errorf("error reading %q response body: %v", apiUrl, err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, fmt.Errorf("error contacting pcloud %q service: %s", apiUrl, resp.Status)
	}
	if outputObj != nil && resp.Header.Get("Content-Type") == "application/json" {
		err = json.Unmarshal(bodyBytes, outputObj)
		if err != nil {
			return resp, fmt.Errorf("error decoding json: %v", err)
		}
	}
	return resp, nil
}

func SendTelemetry(ctx context.Context, force bool) error {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return fmt.Errorf("cannot retrieve client data: %v", err)
	}
	if !force && clientData.ClientOpts.NoTelemetry {
		return nil
	}
	activity, err := sstore.GetNonUploadedActivity(ctx)
	if err != nil {
		return fmt.Errorf("cannot get activity: %v", err)
	}
	if len(activity) == 0 {
		return nil
	}
	log.Printf("sending telemetry data\n")
	dayStr := sstore.GetCurDayStr()
	input := TelemetryInputType{UserId: clientData.UserId, ClientId: clientData.ClientId, CurDay: dayStr, Activity: activity}
	req, err := makeAnonPostReq(ctx, TelemetryUrl, input)
	if err != nil {
		return err
	}
	_, err = doRequest(req, nil)
	if err != nil {
		return err
	}
	err = sstore.MarkActivityAsUploaded(ctx, activity)
	if err != nil {
		return fmt.Errorf("error marking activity as uploaded: %v", err)
	}
	return nil
}

func SendNoTelemetryUpdate(ctx context.Context, noTelemetryVal bool) error {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return fmt.Errorf("cannot retrieve client data: %v", err)
	}
	req, err := makeAnonPostReq(ctx, NoTelemetryUrl, NoTelemetryInputType{ClientId: clientData.ClientId, Value: noTelemetryVal})
	if err != nil {
		return err
	}
	_, err = doRequest(req, nil)
	if err != nil {
		return err
	}
	return nil
}

func getAuthInfo(ctx context.Context) (AuthInfo, error) {
	clientData, err := sstore.EnsureClientData(ctx)
	if err != nil {
		return AuthInfo{}, fmt.Errorf("cannot retrieve client data: %v", err)
	}
	return AuthInfo{UserId: clientData.UserId, ClientId: clientData.ClientId}, nil
}

func CreateCloudSession(ctx context.Context) error {
	authInfo, err := getAuthInfo(ctx)
	if err != nil {
		return err
	}
	req, err := makeAuthPostReq(ctx, CreateCloudSessionUrl, authInfo, nil)
	if err != nil {
		return err
	}
	_, err = doRequest(req, nil)
	if err != nil {
		return err
	}
	return nil
}

func NotifyUpdateWriter() {
}
