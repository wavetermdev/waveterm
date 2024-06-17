// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
)

type RpcMessageUnmarshalHelper struct {
	Command string
	ReqId   string
	ResId   string
	M       map[string]any

	Req *RpcRequest
	Res *RpcResponse
}

func (helper *RpcMessageUnmarshalHelper) UnmarshalJSON(data []byte) error {
	var rmap map[string]any
	if err := json.Unmarshal(data, &rmap); err != nil {
		return err
	}
	if command, ok := rmap["command"].(string); ok {
		helper.Command = command
	}
	if reqid, ok := rmap["reqid"].(string); ok {
		helper.ReqId = reqid
	}
	if resid, ok := rmap["resid"].(string); ok {
		helper.ResId = resid
	}
	if helper.ReqId != "" && helper.ResId != "" {
		return fmt.Errorf("both reqid and resid cannot be set")
	}
	if helper.Command == "" && helper.ResId == "" {
		return fmt.Errorf("either command or resid must be set")
	}
	helper.M = rmap
	if helper.Command != "" {
		// ok, this is a request, so lets parse it
		req, err := helper.parseRequest()
		if err != nil {
			return fmt.Errorf("error parsing request: %w", err)
		}
		helper.Req = req
	} else {
		// this is a response, parse it
		res, err := helper.parseResponse()
		if err != nil {
			return fmt.Errorf("error parsing response: %w", err)
		}
		helper.Res = res
	}
	return nil
}

func (helper *RpcMessageUnmarshalHelper) parseRequest() (*RpcRequest, error) {
	req := &RpcRequest{
		ReqId: helper.ReqId,
	}
	if helper.M["timeoutms"] != nil {
		timeoutMs, ok := helper.M["timeoutms"].(float64)
		if !ok {
			return nil, fmt.Errorf("timeoutms field is not a number")
		}
		req.TimeoutMs = int(timeoutMs)
	}
	cmd, err := ParseCmdMap(helper.M)
	if err != nil {
		return nil, fmt.Errorf("error parsing command: %w", err)
	}
	req.Command = cmd
	return req, nil
}

func (helper *RpcMessageUnmarshalHelper) parseResponse() (*RpcResponse, error) {
	rtn := &RpcResponse{
		ResId: helper.ResId,
		Data:  helper.M,
	}
	if helper.M["error"] != nil {
		errStr, ok := helper.M["error"].(string)
		if !ok {
			return nil, fmt.Errorf("error field is not a string")
		}
		rtn.Error = errStr
	}
	if helper.M["cont"] != nil {
		cont, ok := helper.M["cont"].(bool)
		if !ok {
			return nil, fmt.Errorf("cont field is not a bool")
		}
		rtn.Cont = cont
	}
	delete(rtn.Data, "resid")
	delete(rtn.Data, "error")
	delete(rtn.Data, "cont")
	return rtn, nil
}
