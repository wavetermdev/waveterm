package pcloud

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

	"github.com/scripthaus-dev/sh2-server/pkg/rtnstate"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const PCloudEndpoint = "https://api.getprompt.dev/central"
const PCloudEndpointVarName = "PCLOUD_ENDPOINT"
const APIVersion = 1
const MaxPtyUpdateSize = (128 * 1024) + 1

const TelemetryUrl = "/telemetry"
const NoTelemetryUrl = "/no-telemetry"
const CreateWebScreenUrl = "/auth/create-web-screen"

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

func defaultError(err error, estr string) error {
	if err != nil {
		return err
	}
	return errors.New(estr)
}

func makeWebScreenUpdate(ctx context.Context, update sstore.ScreenUpdateType) (*WebShareUpdateType, error) {
	rtn := &WebShareUpdateType{
		ScreenId:   update.ScreenId,
		LineId:     update.LineId,
		UpdateType: update.UpdateType,
	}
	switch update.UpdateType {
	case sstore.UpdateType_ScreenNew:
		screen, err := sstore.GetScreenById(ctx, update.ScreenId)
		if err != nil || screen == nil {
			return nil, fmt.Errorf("error getting screen: %v", defaultError(err, "not found"))
		}
		rtn.Screen, err = webScreenFromScreen(screen)
		if err != nil {
			return nil, fmt.Errorf("error converting screen to web-screen: %v", err)
		}

	case sstore.UpdateType_ScreenDel:
		break

	case sstore.UpdateType_ScreenName:
		screen, err := sstore.GetScreenById(ctx, update.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("error getting screen: %v", err)
		}
		if screen == nil || screen.WebShareOpts == nil || screen.WebShareOpts.ShareName == "" {
			return nil, fmt.Errorf("invalid screen sharename (makeWebScreenUpdate)")
		}
		rtn.SVal = screen.WebShareOpts.ShareName

	case sstore.UpdateType_LineNew:
		line, cmd, err := sstore.GetLineCmdByLineId(ctx, update.ScreenId, update.LineId)
		if err != nil || line == nil {
			return nil, fmt.Errorf("error getting line/cmd: %v", defaultError(err, "not found"))
		}
		rtn.Line, err = webLineFromLine(line)
		if err != nil {
			return nil, fmt.Errorf("error converting line to web-line: %v", err)
		}
		if cmd != nil {
			rtn.Cmd, err = webCmdFromCmd(cmd)
			if err != nil {
				return nil, fmt.Errorf("error converting cmd to web-cmd: %v", err)
			}
		}

	case sstore.UpdateType_LineDel:
		break

	case sstore.UpdateType_LineArchived:
		line, err := sstore.GetLineById(ctx, update.ScreenId, update.LineId)
		if err != nil || line == nil {
			return nil, fmt.Errorf("error getting line: %v", defaultError(err, "not found"))
		}
		rtn.BVal = line.Archived

	case sstore.UpdateType_LineRenderer:
		line, err := sstore.GetLineById(ctx, update.ScreenId, update.LineId)
		if err != nil || line == nil {
			return nil, fmt.Errorf("error getting line: %v", defaultError(err, "not found"))
		}
		rtn.SVal = line.Renderer

	case sstore.UpdateType_CmdStatus:
		_, cmd, err := sstore.GetLineCmdByLineId(ctx, update.ScreenId, update.LineId)
		if err != nil || cmd == nil {
			return nil, fmt.Errorf("error getting cmd: %v", defaultError(err, "not found"))
		}
		rtn.SVal = cmd.Status

	case sstore.UpdateType_CmdDoneInfo:
		_, cmd, err := sstore.GetLineCmdByLineId(ctx, update.ScreenId, update.LineId)
		if err != nil || cmd == nil {
			return nil, fmt.Errorf("error getting cmd: %v", defaultError(err, "not found"))
		}
		rtn.DoneInfo = cmd.DoneInfo

	case sstore.UpdateType_CmdRtnState:
		_, cmd, err := sstore.GetLineCmdByLineId(ctx, update.ScreenId, update.LineId)
		if err != nil || cmd == nil {
			return nil, fmt.Errorf("error getting cmd: %v", defaultError(err, "not found"))
		}
		data, err := rtnstate.GetRtnStateDiff(ctx, update.ScreenId, cmd.CmdId)
		if err != nil {
			return nil, fmt.Errorf("cannot compute rtnstate: %v", err)
		}
		rtn.SVal = string(data)

	case sstore.UpdateType_PtyPos:
		cmdId, err := sstore.GetCmdIdFromLineId(ctx, update.ScreenId, update.LineId)
		if err != nil {
			return nil, fmt.Errorf("error getting cmdid: %v", err)
		}
		ptyPos, err := sstore.GetWebPtyPos(ctx, update.ScreenId, update.LineId)
		if err != nil {
			return nil, fmt.Errorf("error getting ptypos: %v", err)
		}
		realOffset, data, err := sstore.ReadPtyOutFile(ctx, update.ScreenId, cmdId, ptyPos, MaxPtyUpdateSize)
		if err != nil {
			return nil, fmt.Errorf("error getting ptydata: %v", err)
		}
		rtn.PtyData = &WebSharePtyData{PtyPos: realOffset, Data: data}

	default:
		return nil, fmt.Errorf("unsupported update type (pcloud/makeWebScreenUpdate): %s\n", update.UpdateType)
	}
	return rtn, nil
}

func finalizeWebScreenUpdate(ctx context.Context, screenUpdate sstore.ScreenUpdateType, webUpdate *WebShareUpdateType) error {
	switch screenUpdate.UpdateType {
	case sstore.UpdateType_PtyPos:
		dataEof := len(webUpdate.PtyData.Data) < MaxPtyUpdateSize
		newPos := webUpdate.PtyData.PtyPos + int64(len(webUpdate.PtyData.Data))
		if dataEof {
			err := sstore.RemoveScreenUpdate(ctx, screenUpdate.UpdateType)
			if err != nil {
				return err
			}
		}
		err := sstore.SetWebPtyPos(ctx, screenUpdate.ScreenId, screenUpdate.LineId, newPos)
		if err != nil {
			return err
		}

	default:
		err := sstore.RemoveScreenUpdate(ctx, screenUpdate.UpdateType)
		if err != nil {
			// this is not great, this *should* never fail and is not easy to recover from
			return err
		}
	}
	return nil
}

func DoWebScreenUpdate(ctx context.Context, update sstore.ScreenUpdateType) error {
	return nil
}

func CreateWebScreen(ctx context.Context, screen *WebShareScreenType) error {
	authInfo, err := getAuthInfo(ctx)
	if err != nil {
		return err
	}
	req, err := makeAuthPostReq(ctx, CreateWebScreenUrl, authInfo, screen)
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
