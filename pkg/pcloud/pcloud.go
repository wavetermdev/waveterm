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
	"sync"
	"time"

	"github.com/scripthaus-dev/sh2-server/pkg/dbutil"
	"github.com/scripthaus-dev/sh2-server/pkg/rtnstate"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const PCloudEndpoint = "https://api.getprompt.dev/central"
const PCloudEndpointVarName = "PCLOUD_ENDPOINT"
const APIVersion = 1
const MaxPtyUpdateSize = (128 * 1024)
const MaxUpdatesPerReq = 10
const MaxUpdatesToDeDup = 1000
const MaxUpdateWriterErrors = 3
const PCloudDefaultTimeout = 5 * time.Second
const PCloudWebShareUpdateTimeout = 15 * time.Second

// setting to 1M to be safe (max is 6M for API-GW + Lambda, but there is base64 encoding and upload time)
// we allow one extra update past this estimated size
const MaxUpdatePayloadSize = 1 * (1024 * 1024)

const TelemetryUrl = "/telemetry"
const NoTelemetryUrl = "/no-telemetry"
const WebShareUpdateUrl = "/auth/web-share-update"

var updateWriterLock = &sync.Mutex{}
var updateWriterRunning = false

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
	log.Printf("[pcloud] sending request %v\n", req.URL)
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
	log.Printf("[pcloud] sending telemetry data\n")
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

func MakeScreenNewUpdate(screen *sstore.ScreenType, webShareOpts sstore.ScreenWebShareOpts) *WebShareUpdateType {
	rtn := &WebShareUpdateType{
		ScreenId:   screen.ScreenId,
		UpdateId:   -1,
		UpdateType: sstore.UpdateType_ScreenNew,
		UpdateTs:   time.Now().UnixMilli(),
	}
	rtn.Screen = &WebShareScreenType{
		ScreenId:     screen.ScreenId,
		SelectedLine: int(screen.SelectedLine),
		ShareName:    webShareOpts.ShareName,
		ViewKey:      webShareOpts.ViewKey,
	}
	return rtn
}

func MakeScreenDelUpdate(screen *sstore.ScreenType, screenId string) *WebShareUpdateType {
	rtn := &WebShareUpdateType{
		ScreenId:   screenId,
		UpdateId:   -1,
		UpdateType: sstore.UpdateType_ScreenDel,
		UpdateTs:   time.Now().UnixMilli(),
	}
	return rtn
}

func makeWebShareUpdate(ctx context.Context, update *sstore.ScreenUpdateType) (*WebShareUpdateType, error) {
	rtn := &WebShareUpdateType{
		ScreenId:   update.ScreenId,
		LineId:     update.LineId,
		UpdateId:   update.UpdateId,
		UpdateType: update.UpdateType,
		UpdateTs:   update.UpdateTs,
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

	case sstore.UpdateType_ScreenName, sstore.UpdateType_ScreenSelectedLine:
		screen, err := sstore.GetScreenById(ctx, update.ScreenId)
		if err != nil {
			return nil, fmt.Errorf("error getting screen: %v", err)
		}
		if screen == nil || screen.WebShareOpts == nil {
			return nil, fmt.Errorf("invalid screen, not webshared (makeWebScreenUpdate)")
		}
		if update.UpdateType == sstore.UpdateType_ScreenName {
			rtn.SVal = screen.WebShareOpts.ShareName
		} else if update.UpdateType == sstore.UpdateType_ScreenSelectedLine {
			rtn.IVal = int64(screen.SelectedLine)
		}

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
			rtn.Cmd, err = webCmdFromCmd(update.LineId, cmd)
			if err != nil {
				return nil, fmt.Errorf("error converting cmd to web-cmd: %v", err)
			}
		}

	case sstore.UpdateType_LineDel:
		break

	case sstore.UpdateType_LineRenderer, sstore.UpdateType_LineContentHeight:
		line, err := sstore.GetLineById(ctx, update.ScreenId, update.LineId)
		if err != nil || line == nil {
			return nil, fmt.Errorf("error getting line: %v", defaultError(err, "not found"))
		}
		if update.UpdateType == sstore.UpdateType_LineRenderer {
			rtn.SVal = line.Renderer
		} else if update.UpdateType == sstore.UpdateType_LineContentHeight {
			rtn.IVal = line.ContentHeight
		}

	case sstore.UpdateType_CmdStatus:
		_, cmd, err := sstore.GetLineCmdByLineId(ctx, update.ScreenId, update.LineId)
		if err != nil || cmd == nil {
			return nil, fmt.Errorf("error getting cmd: %v", defaultError(err, "not found"))
		}
		rtn.SVal = cmd.Status

	case sstore.UpdateType_CmdTermOpts:
		_, cmd, err := sstore.GetLineCmdByLineId(ctx, update.ScreenId, update.LineId)
		if err != nil || cmd == nil {
			return nil, fmt.Errorf("error getting cmd: %v", defaultError(err, "not found"))
		}
		rtn.TermOpts = &cmd.TermOpts

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
		realOffset, data, err := sstore.ReadPtyOutFile(ctx, update.ScreenId, cmdId, ptyPos, MaxPtyUpdateSize+1)
		if err != nil {
			return nil, fmt.Errorf("error getting ptydata: %v", err)
		}
		if len(data) == 0 {
			return nil, nil
		}
		if len(data) > MaxPtyUpdateSize {
			rtn.PtyData = &WebSharePtyData{PtyPos: realOffset, Data: data[0:MaxPtyUpdateSize], Eof: false}
		} else {
			rtn.PtyData = &WebSharePtyData{PtyPos: realOffset, Data: data, Eof: true}
		}

	default:
		return nil, fmt.Errorf("unsupported update type (pcloud/makeWebScreenUpdate): %s\n", update.UpdateType)
	}
	return rtn, nil
}

func finalizeWebScreenUpdate(ctx context.Context, webUpdate *WebShareUpdateType) error {
	switch webUpdate.UpdateType {
	case sstore.UpdateType_PtyPos:
		newPos := webUpdate.PtyData.PtyPos + int64(len(webUpdate.PtyData.Data))
		err := sstore.SetWebPtyPos(ctx, webUpdate.ScreenId, webUpdate.LineId, newPos)
		if err != nil {
			return err
		}

	case sstore.UpdateType_LineDel:
		err := sstore.DeleteWebPtyPos(ctx, webUpdate.ScreenId, webUpdate.LineId)
		if err != nil {
			return err
		}
	}
	err := sstore.RemoveScreenUpdate(ctx, webUpdate.UpdateId)
	if err != nil {
		// this is not great, this *should* never fail and is not easy to recover from
		return err
	}
	return nil
}

type webShareResponseType struct {
	Success bool                          `json:"success"`
	Data    []*WebShareUpdateResponseType `json:"data"`
}

func convertUpdate(update *sstore.ScreenUpdateType) *WebShareUpdateType {
	webUpdate, err := makeWebShareUpdate(context.Background(), update)
	if err != nil || webUpdate == nil {
		if err != nil {
			log.Printf("[pcloud] error create web-share update updateid:%d: %v", update.UpdateId, err)
		}
		// if err, or no web update created, remove the screenupdate
		removeErr := sstore.RemoveScreenUpdate(context.Background(), update.UpdateId)
		if removeErr != nil {
			// ignore this error too (although this is really problematic, there is nothing to do)
			log.Printf("[pcloud] error removing screen update updateid:%d: %v", update.UpdateId, removeErr)
		}
	}
	return webUpdate
}

func DoSyncWebUpdate(webUpdate *WebShareUpdateType) error {
	authInfo, err := getAuthInfo(context.Background())
	if err != nil {
		return fmt.Errorf("could not get authinfo for request: %v", err)
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), PCloudDefaultTimeout)
	defer cancelFn()
	req, err := makeAuthPostReq(ctx, WebShareUpdateUrl, authInfo, []*WebShareUpdateType{webUpdate})
	if err != nil {
		return fmt.Errorf("cannot create auth-post-req for %s: %v", WebShareUpdateUrl, err)
	}
	var resp webShareResponseType
	_, err = doRequest(req, &resp)
	if err != nil {
		return err
	}
	if len(resp.Data) == 0 {
		return fmt.Errorf("invalid response received from server")
	}
	urt := resp.Data[0]
	if urt.Error != "" {
		return errors.New(urt.Error)
	}
	return nil
}

func DoWebUpdates(webUpdates []*WebShareUpdateType) error {
	if len(webUpdates) == 0 {
		return nil
	}
	authInfo, err := getAuthInfo(context.Background())
	if err != nil {
		return fmt.Errorf("could not get authinfo for request: %v", err)
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), PCloudWebShareUpdateTimeout)
	defer cancelFn()
	req, err := makeAuthPostReq(ctx, WebShareUpdateUrl, authInfo, webUpdates)
	if err != nil {
		return fmt.Errorf("cannot create auth-post-req for %s: %v", WebShareUpdateUrl, err)
	}
	var resp webShareResponseType
	_, err = doRequest(req, &resp)
	if err != nil {
		return err
	}
	respMap := dbutil.MakeGenMapInt64(resp.Data)
	for _, update := range webUpdates {
		err = finalizeWebScreenUpdate(context.Background(), update)
		if err != nil {
			// ignore this error (nothing to do)
			log.Printf("[pcloud] error finalizing web-update: %v\n", err)
		}
		resp := respMap[update.UpdateId]
		if resp == nil {
			resp = &WebShareUpdateResponseType{Success: false, Error: "resp not found"}
		}
		if resp.Error != "" {
			log.Printf("[pcloud] error updateid:%d, type:%s %s/%s err:%v\n", update.UpdateId, update.UpdateType, update.ScreenId, update.LineId, resp.Error)
		}
	}
	return nil
}

func setUpdateWriterRunning(running bool) {
	updateWriterLock.Lock()
	defer updateWriterLock.Unlock()
	updateWriterRunning = running
}

func GetUpdateWriterRunning() bool {
	updateWriterLock.Lock()
	defer updateWriterLock.Unlock()
	return updateWriterRunning
}

func StartUpdateWriter() {
	updateWriterLock.Lock()
	defer updateWriterLock.Unlock()
	if updateWriterRunning {
		return
	}
	updateWriterRunning = true
	go runWebShareUpdateWriter()
}

func computeBackoff(numFailures int) time.Duration {
	switch numFailures {
	case 1:
		return 500 * time.Millisecond
	case 2:
		return 2 * time.Second
	case 3:
		return 5 * time.Second
	case 4:
		return time.Minute
	case 5:
		return 5 * time.Minute
	case 6:
		return time.Hour
	default:
		return time.Hour
	}
}

type updateKey struct {
	ScreenId   string
	LineId     string
	UpdateType string
}

func DeDupUpdates(ctx context.Context, updateArr []*sstore.ScreenUpdateType) ([]*sstore.ScreenUpdateType, error) {
	var rtn []*sstore.ScreenUpdateType
	var idsToDelete []int64
	umap := make(map[updateKey]bool)
	for _, update := range updateArr {
		key := updateKey{ScreenId: update.ScreenId, LineId: update.LineId, UpdateType: update.UpdateType}
		if umap[key] {
			idsToDelete = append(idsToDelete, update.UpdateId)
			continue
		}
		umap[key] = true
		rtn = append(rtn, update)
	}
	if len(idsToDelete) > 0 {
		err := sstore.RemoveScreenUpdates(ctx, idsToDelete)
		if err != nil {
			return nil, fmt.Errorf("error trying to delete screenupdates: %v\n", err)
		}
	}
	return rtn, nil
}

func runWebShareUpdateWriter() {
	defer func() {
		setUpdateWriterRunning(false)
	}()
	log.Printf("[pcloud] starting update writer\n")
	numErrors := 0
	numSendErrors := 0
	for {
		if numErrors > MaxUpdateWriterErrors {
			log.Printf("[pcloud] update-writer, too many errors, exiting\n")
			break
		}
		time.Sleep(100 * time.Millisecond)
		fullUpdateArr, err := sstore.GetScreenUpdates(context.Background(), MaxUpdatesToDeDup)
		if err != nil {
			log.Printf("[pcloud] error retrieving updates: %v", err)
			time.Sleep(1 * time.Second)
			numErrors++
			continue
		}
		updateArr, err := DeDupUpdates(context.Background(), fullUpdateArr)
		if err != nil {
			log.Printf("[pcloud] error deduping screenupdates: %v", err)
			time.Sleep(1 * time.Second)
			numErrors++
			continue
		}
		numErrors = 0

		var webUpdateArr []*WebShareUpdateType
		totalSize := 0
		for _, update := range updateArr {
			webUpdate := convertUpdate(update)
			if webUpdate == nil {
				continue
			}
			webUpdateArr = append(webUpdateArr, webUpdate)
			totalSize += webUpdate.GetEstimatedSize()
			if totalSize > MaxUpdatePayloadSize {
				break
			}
		}
		if len(webUpdateArr) == 0 {
			sstore.UpdateWriterCheckMoreData()
			continue
		}
		err = DoWebUpdates(webUpdateArr)
		if err != nil {
			numSendErrors++
			backoffTime := computeBackoff(numSendErrors)
			log.Printf("[pcloud] error processing %d web-updates (backoff=%v): %v\n", len(webUpdateArr), backoffTime, err)
			time.Sleep(backoffTime)
			continue
		}
		log.Printf("[pcloud] sent %d web-updates\n", len(webUpdateArr))
		var debugStrs []string
		for _, webUpdate := range webUpdateArr {
			debugStrs = append(debugStrs, webUpdate.String())
		}
		log.Printf("[pcloud] updates: %s\n", strings.Join(debugStrs, " "))
		numSendErrors = 0
	}
}
