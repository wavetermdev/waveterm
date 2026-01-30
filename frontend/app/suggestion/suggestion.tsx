// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { isBlank, makeIconClass } from "@/util/util";
import { offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { Atom, useAtomValue } from "jotai";
import React, { ReactNode, useEffect, useId, useRef, useState } from "react";

interface SuggestionControlProps {
    anchorRef: React.RefObject<HTMLElement>;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: SuggestionType, queryStr: string) => boolean;
    onTab?: (item: SuggestionType, queryStr: string) => string;
    fetchSuggestions: SuggestionsFnType;
    className?: string;
    placeholderText?: string;
    children?: React.ReactNode;
}

type BlockHeaderSuggestionControlProps = Omit<SuggestionControlProps, "anchorRef" | "isOpen"> & {
    blockRef: React.RefObject<HTMLElement>;
    openAtom: Atom<boolean>;
};

function SuggestionControl({
    anchorRef,
    isOpen,
    onClose,
    onSelect,
    onTab,
    fetchSuggestions,
    className,
    children,
}: SuggestionControlProps) {
    if (!isOpen || !anchorRef.current || !fetchSuggestions) return null;

    return (
        <SuggestionControlInner {...{ anchorRef, onClose, onSelect, onTab, fetchSuggestions, className, children }} />
    );
}

function highlightPositions(target: string, positions: number[]): ReactNode[] {
    if (target == null) {
        return [];
    }
    if (positions == null) {
        return [target];
    }
    const result: ReactNode[] = [];
    let targetIndex = 0;
    let posIndex = 0;

    while (targetIndex < target.length) {
        if (posIndex < positions.length && targetIndex === positions[posIndex]) {
            result.push(
                <span key={`h-${targetIndex}`} className="text-blue-500 font-bold">
                    {target[targetIndex]}
                </span>
            );
            posIndex++;
        } else {
            result.push(target[targetIndex]);
        }
        targetIndex++;
    }
    return result;
}

function getMimeTypeIconAndColor(fullConfig: FullConfigType, mimeType: string): [string, string] {
    if (mimeType == null) {
        return [null, null];
    }
    while (mimeType.length > 0) {
        const icon = fullConfig.mimetypes?.[mimeType]?.icon ?? null;
        const iconColor = fullConfig.mimetypes?.[mimeType]?.color ?? null;
        if (icon != null) {
            return [icon, iconColor];
        }
        mimeType = mimeType.slice(0, -1);
    }
    return [null, null];
}

function SuggestionIcon({ suggestion }: { suggestion: SuggestionType }) {
    if (suggestion.iconsrc) {
        return <img src={suggestion.iconsrc} alt="favicon" className="w-4 h-4 object-contain" />;
    }
    if (suggestion.icon) {
        const iconClass = makeIconClass(suggestion.icon, true);
        const iconColor = suggestion.iconcolor;
        return <i className={iconClass} style={{ color: iconColor }} />;
    }
    if (suggestion.type === "url") {
        const iconClass = makeIconClass("globe", true);
        const iconColor = suggestion.iconcolor;
        return <i className={iconClass} style={{ color: iconColor }} />;
    } else if (suggestion.type === "file") {
        // For file suggestions, use the existing logic.
        const fullConfig = useAtomValue(atoms.fullConfigAtom);
        let icon: string = null;
        let iconColor: string = null;
        if (icon == null && suggestion["file:mimetype"] != null) {
            [icon, iconColor] = getMimeTypeIconAndColor(fullConfig, suggestion["file:mimetype"]);
        }
        const iconClass = makeIconClass(icon, true, { defaultIcon: "file" });
        return <i className={iconClass} style={{ color: iconColor }} />;
    }
    const iconClass = makeIconClass("file", true);
    return <i className={iconClass} />;
}

function SuggestionContent({ suggestion }: { suggestion: SuggestionType }) {
    if (!isBlank(suggestion.subtext)) {
        return (
            <div className="flex flex-col">
                {/* Title on the first line, with highlighting */}
                <div className="truncate text-white">{highlightPositions(suggestion.display, suggestion.matchpos)}</div>
                {/* Subtext on the second line in a smaller, grey style */}
                <div className="truncate text-sm text-secondary">
                    {highlightPositions(suggestion.subtext, suggestion.submatchpos)}
                </div>
            </div>
        );
    }
    return <span className="truncate">{highlightPositions(suggestion.display, suggestion.matchpos)}</span>;
}

function BlockHeaderSuggestionControl(props: BlockHeaderSuggestionControlProps) {
    const [headerElem, setHeaderElem] = useState<HTMLElement>(null);
    const isOpen = useAtomValue(props.openAtom);

    useEffect(() => {
        if (props.blockRef.current == null) {
            setHeaderElem(null);
            return;
        }
        const headerElem = props.blockRef.current.querySelector("[data-role='block-header']");
        setHeaderElem(headerElem as HTMLElement);
    }, [props.blockRef.current]);

    const newClass = clsx(props.className, "rounded-t-none");
    return <SuggestionControl {...props} anchorRef={{ current: headerElem }} isOpen={isOpen} className={newClass} />;
}

/**
 * The empty state component that can be used as a child of SuggestionControl.
 * If no children are provided to SuggestionControl, this default empty state will be used.
 */
function SuggestionControlNoResults({ children }: { children?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-center min-h-[120px] p-4">
            {children ?? <span className="text-gray-500">No Suggestions</span>}
        </div>
    );
}

function SuggestionControlNoData({ children }: { children?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-center min-h-[120px] p-4">
            {children ?? <span className="text-gray-500">No Suggestions</span>}
        </div>
    );
}

interface SuggestionControlInnerProps extends Omit<SuggestionControlProps, "isOpen"> {}

function SuggestionControlInner({
    anchorRef,
    onClose,
    onSelect,
    onTab,
    fetchSuggestions,
    className,
    placeholderText,
    children,
}: SuggestionControlInnerProps) {
    const widgetId = useId();
    const [query, setQuery] = useState("");
    const reqNumRef = useRef(0);
    let [suggestions, setSuggestions] = useState<SuggestionType[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [fetched, setFetched] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { refs, floatingStyles, middlewareData } = useFloating({
        placement: "bottom",
        strategy: "absolute",
        middleware: [offset(-1)],
    });
    const emptyStateChild = React.Children.toArray(children).find(
        (child) => React.isValidElement(child) && child.type === SuggestionControlNoResults
    );
    const noDataChild = React.Children.toArray(children).find(
        (child) => React.isValidElement(child) && child.type === SuggestionControlNoData
    );

    useEffect(() => {
        refs.setReference(anchorRef.current);
    }, [anchorRef.current]);

    useEffect(() => {
        reqNumRef.current++;
        fetchSuggestions(query, { widgetid: widgetId, reqnum: reqNumRef.current }).then((results) => {
            if (results.reqnum !== reqNumRef.current) {
                return;
            }
            setSuggestions(results.suggestions ?? []);
            setFetched(true);
        });
    }, [query, fetchSuggestions]);

    useEffect(() => {
        return () => {
            reqNumRef.current++;
            fetchSuggestions("", { widgetid: widgetId, reqnum: reqNumRef.current, dispose: true });
        };
    }, []);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose, anchorRef]);

    useEffect(() => {
        if (dropdownRef.current) {
            const children = dropdownRef.current.children;
            if (children[selectedIndex]) {
                (children[selectedIndex] as HTMLElement).scrollIntoView({
                    behavior: "auto",
                    block: "nearest",
                });
            }
        }
    }, [selectedIndex]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            let suggestion: SuggestionType = null;
            if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
                suggestion = suggestions[selectedIndex];
            }
            if (onSelect(suggestion, query)) {
                onClose();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            const suggestion = suggestions[selectedIndex];
            if (suggestion != null) {
                const tabResult = onTab?.(suggestion, query);
                if (tabResult != null) {
                    setQuery(tabResult);
                }
            }
        } else if (e.key === "PageDown") {
            e.preventDefault();
            e.stopPropagation();
            setSelectedIndex((prev) => Math.min(prev + 10, suggestions.length - 1));
        } else if (e.key === "PageUp") {
            e.preventDefault();
            e.stopPropagation();
            setSelectedIndex((prev) => Math.max(prev - 10, 0));
        }
    };
    return (
        <div
            className={clsx(
                "w-96 rounded-lg bg-modalbg shadow-lg border border-gray-700 z-[var(--zindex-typeahead-modal)] absolute",
                middlewareData?.offset == null ? "opacity-0" : null,
                className
            )}
            ref={refs.setFloating}
            style={floatingStyles}
        >
            <div className="p-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setSelectedIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-zinc-900 text-gray-100 px-4 py-2 rounded-md border border-gray-700 focus:outline-none focus:border-accent placeholder-secondary"
                    placeholder={placeholderText}
                />
            </div>
            {fetched &&
                (suggestions.length > 0 ? (
                    <div ref={dropdownRef} className="max-h-96 overflow-y-auto divide-y divide-gray-700">
                        {suggestions.map((suggestion, index) => (
                            <div
                                key={suggestion.suggestionid}
                                className={clsx(
                                    "flex items-center gap-3 px-4 py-2 cursor-pointer",
                                    index === selectedIndex ? "bg-accentbg" : "hover:bg-hoverbg",
                                    "text-gray-100"
                                )}
                                onClick={() => {
                                    onSelect(suggestion, query);
                                    onClose();
                                }}
                            >
                                <SuggestionIcon suggestion={suggestion} />
                                <SuggestionContent suggestion={suggestion} />
                            </div>
                        ))}
                    </div>
                ) : (
                    // Render the empty state (either a provided child or the default)
                    <div key="empty" className="flex items-center justify-center min-h-[120px] p-4">
                        {query === ""
                            ? (noDataChild ?? <SuggestionControlNoData />)
                            : (emptyStateChild ?? <SuggestionControlNoResults />)}
                    </div>
                ))}
        </div>
    );
}

export { BlockHeaderSuggestionControl, SuggestionControl, SuggestionControlNoData, SuggestionControlNoResults };
