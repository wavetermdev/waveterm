// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatRemoteUri } from "@/util/waveutil";
import type React from "react";
import { openLink } from "../store/global";

export const MarkdownLink = ({
    setFocusedHeading,
    props,
    resolveOpts,
    onOpenFile,
}: {
    props: React.AnchorHTMLAttributes<HTMLAnchorElement>;
    setFocusedHeading: (href: string) => void;
    resolveOpts?: MarkdownResolveOpts;
    onOpenFile?: (path: string) => Promise<void>;
}) => {
    const onClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        const href = props.href;
        if (!href) {
            return;
        }
        if (href.startsWith("#")) {
            setFocusedHeading(href);
        } else if (resolveOpts && onOpenFile && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
            try {
                // Remove URL suffixes before decoding, so escaped # and ? remain part of the filename.
                const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
                if (!path) {
                    return;
                }
                const baseDirUri = formatRemoteUri(resolveOpts.baseDir, resolveOpts.connName);
                const fileInfo = await RpcApi.FileJoinCommand(TabRpcClient, [baseDirUri, path]);
                await onOpenFile(fileInfo.path);
            } catch (err) {
                console.warn("Failed to open Markdown file link:", href, err);
            }
        } else {
            openLink(href);
        }
    };
    return (
        <a href={props.href} onClick={onClick} className="text-accent hover:underline">
            {props.children}
        </a>
    );
};
