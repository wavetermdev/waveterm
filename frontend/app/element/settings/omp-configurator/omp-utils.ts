// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP Configurator Utilities
 *
 * Shared utilities for OMP configuration management.
 */

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

/**
 * Reinitialize OMP in all active terminal blocks
 * This sends the appropriate reinit command to each terminal
 */
export async function reinitOmpInAllTerminals(): Promise<void> {
    try {
        // Get all blocks in the current workspace
        const blocks = await RpcApi.BlocksListCommand(TabRpcClient, {});

        // Filter for terminal blocks and send reinit command to each
        for (const block of blocks) {
            if (block.meta?.view === "term") {
                try {
                    await RpcApi.OmpReinitCommand(TabRpcClient, { blockid: block.blockid });
                } catch (err) {
                    // Log but don't fail - individual terminals may not support OMP
                    console.warn(`Failed to reinit OMP for block ${block.blockid}:`, err);
                }
            }
        }
    } catch (err) {
        console.error("Failed to get blocks for OMP reinit:", err);
    }
}
