// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/service"
)

type handlerTestService struct {
	calls int
}

func (svc *handlerTestService) Invoke() {
	svc.calls++
}

func (svc *handlerTestService) Unserializable() chan int {
	return make(chan int)
}

func TestHandleServiceRejectsInvalidBodyWithoutCallingService(t *testing.T) {
	svc := &handlerTestService{}
	service.ServiceMap["handler-test"] = svc
	t.Cleanup(func() { delete(service.ServiceMap, "handler-test") })

	body := `{"service":"handler-test","method":"Invoke","args":[],"uicontext":123}`
	var partialCall service.WebCallType
	if err := json.Unmarshal([]byte(body), &partialCall); err == nil || partialCall.Service != "handler-test" || partialCall.Method != "Invoke" {
		t.Fatalf("invalid test body did not partially decode a service call: %+v, %v", partialCall, err)
	}

	req := httptest.NewRequest(http.MethodPost, "/wave/service", strings.NewReader(body))
	resp := httptest.NewRecorder()
	handleService(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.Code)
	}
	if svc.calls != 0 {
		t.Fatalf("service invoked %d times for invalid body", svc.calls)
	}
	if !strings.HasPrefix(resp.Body.String(), "invalid request body:") || strings.Count(resp.Body.String(), "\n") != 1 {
		t.Fatalf("unexpected response body: %q", resp.Body.String())
	}
}

func TestHandleServiceStopsAfterMarshalError(t *testing.T) {
	service.ServiceMap["handler-test"] = &handlerTestService{}
	t.Cleanup(func() { delete(service.ServiceMap, "handler-test") })

	req := httptest.NewRequest(http.MethodPost, "/wave/service", strings.NewReader(`{"service":"handler-test","method":"Unserializable","args":[]}`))
	resp := httptest.NewRecorder()
	handleService(resp, req)

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.Code)
	}
	if got := resp.Header().Get(ContentLengthHeaderKey); got != "" {
		t.Fatalf("Content-Length = %q after error response, want unset", got)
	}
}

func TestHandleWaveFileRejectsInvalidOffsetFirst(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/wave/file?offset=invalid&zoneid=invalid&name=test", nil)
	resp := httptest.NewRecorder()
	handleWaveFile(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.Code)
	}
	if !strings.HasPrefix(resp.Body.String(), "invalid offset:") || strings.Count(resp.Body.String(), "\n") != 1 {
		t.Fatalf("unexpected response body: %q", resp.Body.String())
	}
}
