// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveEvent } from "@/app/store/wps";
import * as util from "@/util/util";
import debug from "debug";

const dlog = debug("wave:router");

const SysRouteName = "sys";

type RouteInfo = {
    rpcId: string;
    sourceRouteId: string;
    destRouteId: string;
};

function makeFeBlockRouteId(feBlockId: string): string {
    return `feblock:${feBlockId}`;
}

function makeTabRouteId(tabId: string): string {
    return `tab:${tabId}`;
}

function makeBuilderRouteId(builderId: string): string {
    return `builder:${builderId}`;
}

class WshRouter {
    routeMap: Map<string, AbstractWshClient>; // routeid -> client
    upstreamClient: AbstractWshClient;
    rpcMap: Map<string, RouteInfo>; // rpcid -> routeinfo

    constructor(upstreamClient: AbstractWshClient) {
        this.routeMap = new Map();
        this.rpcMap = new Map();
        if (upstreamClient == null) {
            throw new Error("upstream client cannot be null");
        }
        this.upstreamClient = upstreamClient;
    }

    reannounceRoutes() {
        for (const [routeId, client] of this.routeMap) {
            const announceMsg: RpcMessage = {
                command: "routeannounce",
                data: routeId,
                source: routeId,
            };
            this.upstreamClient.recvRpcMessage(announceMsg);
        }
    }

    // returns true if the message was sent
    _sendRoutedMessage(msg: RpcMessage, destRouteId: string) {
        const client = this.routeMap.get(destRouteId);
        if (client) {
            client.recvRpcMessage(msg);
            return;
        }
        // there should always an upstream client
        if (!this.upstreamClient) {
            throw new Error(`no upstream client for message: ${msg}`);
        }
        this.upstreamClient?.recvRpcMessage(msg);
    }

    _registerRouteInfo(reqid: string, sourceRouteId: string, destRouteId: string) {
        dlog("registering route info", reqid, sourceRouteId, destRouteId);
        if (util.isBlank(reqid)) {
            return;
        }
        const routeInfo: RouteInfo = {
            rpcId: reqid,
            sourceRouteId: sourceRouteId,
            destRouteId: destRouteId,
        };
        this.rpcMap.set(reqid, routeInfo);
    }

    recvRpcMessage(msg: RpcMessage) {
        dlog("router received message", msg);
        // we are a terminal node by definition, so we don't need to process with announce/unannounce messages
        if (msg.command == "routeannounce" || msg.command == "routeunannounce") {
            return;
        }
        // handle events
        if (msg.command == "eventrecv") {
            handleWaveEvent(msg.data);
            return;
        }
        if (!util.isBlank(msg.command)) {
            // send + register routeinfo
            if (!util.isBlank(msg.reqid)) {
                this._registerRouteInfo(msg.reqid, msg.source, msg.route);
            }
            this._sendRoutedMessage(msg, msg.route);
            return;
        }
        if (!util.isBlank(msg.reqid)) {
            const routeInfo = this.rpcMap.get(msg.reqid);
            if (!routeInfo) {
                // no route info, discard
                dlog("no route info for reqid, discarding", msg);
                return;
            }
            this._sendRoutedMessage(msg, routeInfo.destRouteId);
            return;
        }
        if (!util.isBlank(msg.resid)) {
            const routeInfo = this.rpcMap.get(msg.resid);
            if (!routeInfo) {
                // no route info, discard
                dlog("no route info for resid, discarding", msg);
                return;
            }
            this._sendRoutedMessage(msg, routeInfo.sourceRouteId);
            if (!msg.cont) {
                dlog("deleting route info", msg.resid);
                this.rpcMap.delete(msg.resid);
            }
            return;
        }
        dlog("bad rpc message recevied by router, no command, reqid, or resid (discarding)", msg);
    }

    registerRoute(routeId: string, client: AbstractWshClient) {
        if (routeId == SysRouteName) {
            throw new Error(`Cannot register route with reserved name (${routeId})`);
        }
        dlog("registering route: ", routeId);
        // announce
        const announceMsg: RpcMessage = {
            command: "routeannounce",
            data: routeId,
            source: routeId,
        };
        this.upstreamClient.recvRpcMessage(announceMsg);
        this.routeMap.set(routeId, client);
    }

    unregisterRoute(routeId: string) {
        dlog("unregister route: ", routeId);
        // unannounce
        const unannounceMsg: RpcMessage = {
            command: "routeunannounce",
            data: routeId,
            source: routeId,
        };
        this.upstreamClient?.recvRpcMessage(unannounceMsg);
        this.routeMap.delete(routeId);
    }
}

export { makeBuilderRouteId, makeFeBlockRouteId, makeTabRouteId, WshRouter };
