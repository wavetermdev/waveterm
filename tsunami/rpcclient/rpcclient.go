// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpcclient

import (
	"errors"

	"github.com/wavetermdev/waveterm/tsunami/rpc"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

func VDomCreateContextCommand(rpcClient *RpcClient, data vdom.VDomCreateContext, opts *rpc.RpcOpts) (rpc.ORef, error) {
	return rpc.ORef{}, errors.New("VDomCreateContextCommand: unimplemented")
}

func WaitForRouteCommand(rpcClient *RpcClient, data rpc.CommandWaitForRouteData, opts *rpc.RpcOpts) (bool, error) {
	return false, errors.New("WaitForRouteCommand: unimplemented")
}

func EventSubCommand(rpcClient *RpcClient, data rpc.SubscriptionRequest, opts *rpc.RpcOpts) error {
	return errors.New("EventSubCommand: unimplemented")
}

func VDomAsyncInitiationCommand(rpcClient *RpcClient, data vdom.VDomAsyncInitiationRequest, opts *rpc.RpcOpts) error {
	return errors.New("VDomAsyncInitiationCommand: unimplemented")
}