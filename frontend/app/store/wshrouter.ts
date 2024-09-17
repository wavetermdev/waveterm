// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveEvent } from "@/app/store/wps";
import debug from "debug";
import * as util from "../../util/util";

const dlog = debug("wave:router");

const SysRouteName = "sys";

type RouteInfo = {
    rpcId: string;
    sourceRouteId: string;
    destRouteId: string;
};

function makeWindowRouteId(windowId: string): string {
    return `window:${windowId}`;
}

function makeFeBlockRouteId(feBlockId: string): string {
    return `feblock:${feBlockId}`;
}

class WshRouter {
    routeMap: Map<string, AbstractWshClient>; // routeid -> client
    upstreamClient: AbstractWshClient;
    rpcMap: Map<string, RouteInfo>; // rpcid -> routeinfo

    constructor(upstreamClient: AbstractWshClient) {
        this.routeMap = new Map();
        this.rpcMap = new Map();
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
    _sendRoutedMessage(msg: RpcMessage, destRouteId: string): boolean {
        const client = this.routeMap.get(destRouteId);
        if (client) {
            client.recvRpcMessage(msg);
            return true;
        }
        if (!this.upstreamClient) {
            // there should always be an upstream client
            return false;
        }
        this.upstreamClient?.recvRpcMessage(msg);
        return true;
    }

    _handleNoRoute(msg: RpcMessage) {
        dlog("no route for message", msg);
        if (util.isBlank(msg.reqid)) {
            // send a message instead
            if (msg.command == "message") {
                return;
            }
            const nrMsg = { command: "message", route: msg.source, data: { message: `no route for ${msg.route}` } };
            this._sendRoutedMessage(nrMsg, SysRouteName);
            return;
        }
        // send an error response
        const nrMsg = { resid: msg.reqid, error: `no route for ${msg.route}` };
        this._sendRoutedMessage(nrMsg, msg.source);
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
            const ok = this._sendRoutedMessage(msg, msg.route);
            if (!ok) {
                this._handleNoRoute(msg);
                return;
            }
            this._registerRouteInfo(msg.reqid, msg.source, msg.route);
            return;
        }
        if (!util.isBlank(msg.reqid)) {
            const routeInfo = this.rpcMap.get(msg.reqid);
            if (!routeInfo) {
                // no route info, discard
                return;
            }
            this._sendRoutedMessage(msg, routeInfo.destRouteId);
            return;
        }
        if (!util.isBlank(msg.resid)) {
            const routeInfo = this.rpcMap.get(msg.resid);
            if (!routeInfo) {
                // no route info, discard
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

export { makeFeBlockRouteId, makeWindowRouteId, WshRouter };
