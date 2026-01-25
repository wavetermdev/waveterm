// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block, SubBlock } from "@/app/block/block";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Search, useSearch } from "@/app/element/search";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useTabModel } from "@/app/store/tab-model";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getOverrideConfigAtom, getSettingsPrefixAtom, globalStore, WOS } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { resolvedAppThemeAtom } from "@/app/hook/usetheme";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TermResyncHandler = React.memo(({ blockId, model }: TerminalViewProps) => {
    const connStatus = jotai.useAtomValue(model.connStatus);
    const [lastConnStatus, setLastConnStatus] = React.useState<ConnStatus>(connStatus);

    React.useEffect(() => {
        if (!model.termRef.current?.hasResized) {
            return;
        }
        const isConnected = connStatus?.status == "connected";
        const wasConnected = lastConnStatus?.status == "connected";
        const curConnName = connStatus?.connection;
        const lastConnName = lastConnStatus?.connection;
        if (isConnected == wasConnected && curConnName == lastConnName) {
            return;
        }
        model.termRef.current?.resyncController("resync handler");
        setLastConnStatus(connStatus);
    }, [connStatus]);

    return null;
});

const TermVDomToolbarNode = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribe({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomtoolbarblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(
        () => ({
            blockId: vdomBlockId,
            isFocused: jotai.atom(false),
            isMagnified: jotai.atom(false),
            focusNode: () => {},
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        }),
        [vdomBlockId]
    );
    const toolbarTarget = jotai.useAtomValue(model.vdomToolbarTarget);
    const heightStr = toolbarTarget?.height ?? "1.5em";
    return (
        <div key="vdomToolbar" className="term-toolbar" style={{ height: heightStr }}>
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNodeSingleId = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribe({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(() => {
        const isFocusedAtom = jotai.atom((get) => {
            return get(model.nodeModel.isFocused) && get(model.termMode) == "vdom";
        });
        return {
            blockId: vdomBlockId,
            isFocused: isFocusedAtom,
            isMagnified: jotai.atom(false),
            focusNode: () => {
                model.nodeModel.focusNode();
            },
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        };
    }, [vdomBlockId, model]);
    return (
        <div key="htmlElem" className="term-htmlelem">
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomBlockId = jotai.useAtomValue(model.vdomBlockId);
    if (vdomBlockId == null) {
        return null;
    }
    return <TermVDomNodeSingleId key={vdomBlockId} vdomBlockId={vdomBlockId} blockId={blockId} model={model} />;
};

const TermToolbarVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomToolbarBlockId = jotai.useAtomValue(model.vdomToolbarBlockId);
    if (vdomToolbarBlockId == null) {
        return null;
    }
    return (
        <TermVDomToolbarNode
            key={vdomToolbarBlockId}
            vdomBlockId={vdomToolbarBlockId}
            blockId={blockId}
            model={model}
        />
    );
};

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termSettingsAtom = getSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);
    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "vdom") {
        termMode = "term";
    }
    const termModeRef = React.useRef(termMode);

    const tabModel = useTabModel();
    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const connFontFamily = fullConfig.connections?.[blockData?.meta?.connection]?.["term:fontfamily"];
    const isFocused = jotai.useAtomValue(model.nodeModel.isFocused);
    const isMI = jotai.useAtomValue(tabModel.isTermMultiInput);
    const isBasicTerm = termMode != "vdom" && blockData?.meta?.controller != "cmd"; // needs to match isBasicTerm

    // search
    const searchProps = useSearch({
        anchorRef: viewRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const searchIsOpen = jotai.useAtomValue<boolean>(searchProps.isOpen);
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive);
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord);
    const regex = useAtomValueSafe<boolean>(searchProps.regex);
    const searchVal = jotai.useAtomValue<string>(searchProps.searchValue);
    const searchDecorations = React.useMemo(
        () => ({
            matchOverviewRuler: "#000000",
            activeMatchColorOverviewRuler: "#000000",
            activeMatchBorder: "#FF9632",
            matchBorder: "#FFFF00",
        }),
        []
    );
    const searchOpts = React.useMemo<ISearchOptions>(
        () => ({
            regex,
            wholeWord,
            caseSensitive,
            decorations: searchDecorations,
        }),
        [regex, wholeWord, caseSensitive]
    );
    const handleSearchError = React.useCallback((e: Error) => {
        console.warn("search error:", e);
    }, []);
    const executeSearch = React.useCallback(
        (searchText: string, direction: "next" | "previous") => {
            if (searchText === "") {
                model.termRef.current?.searchAddon.clearDecorations();
                return;
            }
            try {
                model.termRef.current?.searchAddon[direction === "next" ? "findNext" : "findPrevious"](
                    searchText,
                    searchOpts
                );
            } catch (e) {
                handleSearchError(e);
            }
        },
        [searchOpts, handleSearchError]
    );
    searchProps.onSearch = React.useCallback(
        (searchText: string) => executeSearch(searchText, "previous"),
        [executeSearch]
    );
    searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
    searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
    // Return input focus to the terminal when the search is closed
    React.useEffect(() => {
        if (!searchIsOpen) {
            model.giveFocus();
        }
    }, [searchIsOpen]);
    // rerun search when the searchOpts change
    React.useEffect(() => {
        model.termRef.current?.searchAddon.clearDecorations();
        searchProps.onSearch(searchVal);
    }, [searchOpts]);
    // end search

    React.useEffect(() => {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemeName = globalStore.get(model.termThemeNameAtom);
        const termTransparency = globalStore.get(model.termTransparencyAtom);
        const termMacOptionIsMetaAtom = getOverrideConfigAtom(blockId, "term:macoptionismeta");
        const appTheme = globalStore.get(resolvedAppThemeAtom);
        const [termTheme, _] = computeTheme(fullConfig, termThemeName, termTransparency, appTheme);
        let termScrollback = 2000;
        if (termSettings?.["term:scrollback"]) {
            termScrollback = Math.floor(termSettings["term:scrollback"]);
        }
        if (blockData?.meta?.["term:scrollback"]) {
            termScrollback = Math.floor(blockData.meta["term:scrollback"]);
        }
        if (termScrollback < 0) {
            termScrollback = 0;
        }
        if (termScrollback > 50000) {
            termScrollback = 50000;
        }
        const termAllowBPM = globalStore.get(model.termBPMAtom) ?? true;
        const termMacOptionIsMeta = globalStore.get(termMacOptionIsMetaAtom) ?? false;
        const wasFocused = model.termRef.current != null && globalStore.get(model.nodeModel.isFocused);
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily: termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack",
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl: !termSettings?.["term:disablewebgl"],
                useLigatures: termSettings?.["term:ligatures"],
                sendDataHandler: model.sendDataToController.bind(model),
                nodeModel: model.nodeModel,
                jobId: blockData?.jobid,
            }
        );
        (window as any).term = termWrap;
        model.termRef.current = termWrap;

        // Set up callback to update tab terminal status when shell integration status changes
        termWrap.onShellIntegrationStatusChange = () => {
            model.updateTabTerminalStatus();
        };

        // Update terminal status on init to reflect current state
        // This ensures status icons show the correct state when switching tabs
        model.updateTabTerminalStatus();

        // Delayed status update to catch OSC data that was buffered while tab was inactive
        // When webview resumes, xterm needs time to process buffered data including OSC 16162
        const statusRefreshTimer = setTimeout(() => {
            model.updateTabTerminalStatus();
        }, 500);

        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        termWrap.onSearchResultsDidChange = (results) => {
            globalStore.set(searchProps.resultsIndex, results.resultIndex);
            globalStore.set(searchProps.resultsCount, results.resultCount);
        };
        fireAndForget(termWrap.initTerminal.bind(termWrap));
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            clearTimeout(statusRefreshTimer);
            termWrap.dispose();
            rszObs.disconnect();
        };
    }, [blockId, termSettings, termFontSize, connFontFamily]);

    // Refresh terminal status when tab becomes focused
    // This catches OSC data that was buffered while tab was in background
    const wasFocusedRef = React.useRef(isFocused);
    React.useEffect(() => {
        if (isFocused && !wasFocusedRef.current) {
            // Tab just became focused - refresh status after a delay to let xterm process buffered data
            const timer = setTimeout(() => {
                model.updateTabTerminalStatus();
            }, 300);
            return () => clearTimeout(timer);
        }
        wasFocusedRef.current = isFocused;
    }, [isFocused, model]);

    React.useEffect(() => {
        if (termModeRef.current == "vdom" && termMode == "term") {
            // focus the terminal
            model.giveFocus();
        }
        termModeRef.current = termMode;
    }, [termMode]);

    React.useEffect(() => {
        if (isMI && isBasicTerm && isFocused && model.termRef.current != null) {
            model.termRef.current.multiInputCallback = (data: string) => {
                model.multiInputHandler(data);
            };
        } else {
            if (model.termRef.current != null) {
                model.termRef.current.multiInputCallback = null;
            }
        }
    }, [isMI, isBasicTerm, isFocused]);

    const scrollbarHideObserverRef = React.useRef<HTMLDivElement>(null);
    const onScrollbarShowObserver = React.useCallback(() => {
        const termViewport = viewRef.current.getElementsByClassName("xterm-viewport")[0] as HTMLDivElement;
        termViewport.style.zIndex = "var(--zindex-xterm-viewport-overlay)";
        scrollbarHideObserverRef.current.style.display = "block";
    }, []);
    const onScrollbarHideObserver = React.useCallback(() => {
        const termViewport = viewRef.current.getElementsByClassName("xterm-viewport")[0] as HTMLDivElement;
        termViewport.style.zIndex = "auto";
        scrollbarHideObserverRef.current.style.display = "none";
    }, []);

    const stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: model.termRef.current?.terminal.rows ?? 24,
        cols: model.termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    const customTermBg = computeBgStyleFromMeta(blockData?.meta);
    const termThemeBgColor = jotai.useAtomValue(model.termBgColor);

    const handleContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const menuItems = model.getContextMenuItems();
            ContextMenuModel.showContextMenu(menuItems, e);
        },
        [model]
    );

    // Focus block on any pointerdown in the terminal (including scrollbar)
    // xterm.js scrollbar uses PointerEvents, not MouseEvents
    React.useEffect(() => {
        const elem = viewRef.current;
        if (!elem) return;

        const handlePointerDown = () => {
            if (!globalStore.get(model.nodeModel.isFocused)) {
                model.nodeModel.focusNode();
            }
        };

        // Attach to the view-term element for normal terminal clicks
        elem.addEventListener("pointerdown", handlePointerDown, true);

        // Find and attach to the scrollbar slider directly
        // xterm creates this element asynchronously, so we need to wait/observe
        let sliderElem: Element | null = null;
        const attachSliderListener = () => {
            sliderElem = elem.querySelector(".xterm-scrollable-element > .scrollbar.vertical > .slider");
            if (sliderElem) {
                sliderElem.addEventListener("pointerdown", handlePointerDown, true);
            }
        };

        // Try immediately and also after a short delay (xterm init is async)
        attachSliderListener();
        const timer = setTimeout(attachSliderListener, 500);

        // Also observe for DOM changes in case the terminal reinitializes
        const observer = new MutationObserver(() => {
            const newSlider = elem.querySelector(".xterm-scrollable-element > .scrollbar.vertical > .slider");
            if (newSlider && newSlider !== sliderElem) {
                if (sliderElem) {
                    sliderElem.removeEventListener("pointerdown", handlePointerDown, true);
                }
                sliderElem = newSlider;
                sliderElem.addEventListener("pointerdown", handlePointerDown, true);
            }
        });
        observer.observe(elem, { childList: true, subtree: true });

        return () => {
            clearTimeout(timer);
            observer.disconnect();
            elem.removeEventListener("pointerdown", handlePointerDown, true);
            if (sliderElem) {
                sliderElem.removeEventListener("pointerdown", handlePointerDown, true);
            }
        };
    }, [model.nodeModel]);

    return (
        <div
            className={clsx("view-term", "term-mode-" + termMode)}
            ref={viewRef}
            onContextMenu={handleContextMenu}
            style={{ backgroundColor: termThemeBgColor }}
        >
            {customTermBg && <div className="absolute inset-0 z-0 pointer-events-none" style={customTermBg} />}
            <TermResyncHandler blockId={blockId} model={model} />
            <TermThemeUpdater blockId={blockId} model={model} termRef={model.termRef} />
            <TermStickers config={stickerConfig} />
            <TermToolbarVDomNode key="vdom-toolbar" blockId={blockId} model={model} />
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
            <div key="conntectElem" className="term-connectelem" ref={connectElemRef}>
                <div className="term-scrollbar-show-observer" onPointerOver={onScrollbarShowObserver} />
                <div
                    ref={scrollbarHideObserverRef}
                    className="term-scrollbar-hide-observer"
                    onPointerOver={onScrollbarHideObserver}
                />
            </div>
            <Search {...searchProps} />
        </div>
    );
};

export { TerminalView };
