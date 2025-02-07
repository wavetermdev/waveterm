// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { isBlank, makeIconClass } from "@/util/util";
import { offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import React, { ReactNode, useEffect, useId, useRef, useState } from "react";

interface TypeaheadProps {
    anchorRef: React.RefObject<HTMLElement>;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: SuggestionType, queryStr: string) => void;
    onTab?: (item: SuggestionType, queryStr: string) => string;
    fetchSuggestions: SuggestionsFnType;
    className?: string;
    placeholderText?: string;
}

const Typeahead: React.FC<TypeaheadProps> = ({ anchorRef, isOpen, onClose, onSelect, fetchSuggestions, className }) => {
    if (!isOpen || !anchorRef.current || !fetchSuggestions) return null;

    return <TypeaheadInner {...{ anchorRef, onClose, onSelect, fetchSuggestions, className }} />;
};

function highlightSearchMatch(target: string, search: string, highlightFn: (char: string) => ReactNode): ReactNode[] {
    if (!search || !target) return [target];

    const result: ReactNode[] = [];
    let targetIndex = 0;
    let searchIndex = 0;

    while (targetIndex < target.length) {
        // If we've matched all search chars, add remaining target string
        if (searchIndex >= search.length) {
            result.push(target.slice(targetIndex));
            break;
        }

        // If current chars match
        if (target[targetIndex].toLowerCase() === search[searchIndex].toLowerCase()) {
            // Add highlighted character
            result.push(highlightFn(target[targetIndex]));
            searchIndex++;
            targetIndex++;
        } else {
            // Add non-matching character
            result.push(target[targetIndex]);
            targetIndex++;
        }
    }
    return result;
}

function defaultHighlighter(target: string, search: string): ReactNode[] {
    return highlightSearchMatch(target, search, (char) => <span className="text-blue-500 font-bold">{char}</span>);
}

function highlightPositions(target: string, positions: number[]): ReactNode[] {
    const result: ReactNode[] = [];
    let targetIndex = 0;
    let posIndex = 0;

    while (targetIndex < target.length) {
        if (posIndex < positions.length && targetIndex === positions[posIndex]) {
            result.push(<span className="text-blue-500 font-bold">{target[targetIndex]}</span>);
            posIndex++;
        } else {
            result.push(target[targetIndex]);
        }
        targetIndex++;
    }
    return result;
}

function getHighlightedText(suggestion: SuggestionType, highlightTerm: string): ReactNode[] {
    if (suggestion.matchpositions != null && suggestion.matchpositions.length > 0) {
        return highlightPositions(suggestion.display, suggestion.matchpositions);
    }
    if (isBlank(highlightTerm)) {
        return [suggestion.display];
    }
    return defaultHighlighter(suggestion.display, highlightTerm);
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

const SuggestionIcon: React.FC<{ suggestion: SuggestionType }> = ({ suggestion }) => {
    if (suggestion.iconsrc) {
        return <img src={suggestion.iconsrc} alt="favicon" className="w-4 h-4 rounded-sm object-contain" />;
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
    return makeIconClass("file", true);
};

const SuggestionContent: React.FC<{
    suggestion: SuggestionType;
    highlightTerm: string;
}> = ({ suggestion, highlightTerm }) => {
    if (!isBlank(suggestion.subtext)) {
        return (
            <div className="flex flex-col">
                {/* Title on the first line, with highlighting */}
                <div className="truncate">{getHighlightedText(suggestion, highlightTerm)}</div>
                {/* Subtext on the second line in a smaller, grey style */}
                <div className="truncate text-sm text-gray-400">{suggestion.subtext}</div>
            </div>
        );
    }
    return <span className="truncate">{getHighlightedText(suggestion, highlightTerm)}</span>;
};

const TypeaheadInner: React.FC<Omit<TypeaheadProps, "isOpen">> = ({
    anchorRef,
    onClose,
    onSelect,
    onTab,
    fetchSuggestions,
    className,
    placeholderText,
}) => {
    const widgetId = useId();
    const [query, setQuery] = useState("");
    const reqNumRef = useRef(0);
    const [suggestions, setSuggestions] = useState<SuggestionType[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [highlightTerm, setHighlightTerm] = useState("");
    const [fetched, setFetched] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { refs, floatingStyles, middlewareData } = useFloating({
        placement: "bottom",
        strategy: "absolute",
        middleware: [offset(5)],
    });

    useEffect(() => {
        refs.setReference(anchorRef.current);
    }, [anchorRef.current]);

    useEffect(() => {
        reqNumRef.current++;
        fetchSuggestions(query, { widgetid: widgetId, reqnum: reqNumRef.current }).then((results) => {
            if (results.reqnum != reqNumRef.current) {
                return;
            }
            setSuggestions(results.suggestions ?? []);
            setHighlightTerm(results.highlightterm ?? "");
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter" && selectedIndex >= 0) {
            e.preventDefault();
            onSelect(suggestions[selectedIndex], query);
            onClose();
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        } else if (e.key === "Tab") {
            e.preventDefault();
            const suggestion = suggestions[selectedIndex];
            if (suggestion != null) {
                const tabResult = onTab?.(suggestion, query);
                if (tabResult != null) {
                    setQuery(tabResult);
                }
            }
        }
    };

    return (
        <div
            className={clsx(
                "w-96 rounded-lg bg-gray-800 shadow-lg border border-gray-700 z-[var(--zindex-typeahead-modal)] absolute",
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
                    className="w-full bg-gray-900 text-gray-100 px-4 py-2 rounded-md border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-500"
                    placeholder={placeholderText}
                />
            </div>
            {fetched && suggestions.length > 0 && (
                <div ref={dropdownRef} className="max-h-96 overflow-y-auto divide-y divide-gray-700">
                    {suggestions.map((suggestion, index) => (
                        <div
                            key={suggestion.suggestionid}
                            className={clsx(
                                "flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-700",
                                index === selectedIndex ? "bg-gray-700" : "",
                                "text-gray-100"
                            )}
                            onClick={() => {
                                onSelect(suggestion, query);
                                onClose();
                            }}
                        >
                            <SuggestionIcon suggestion={suggestion} />
                            <SuggestionContent suggestion={suggestion} highlightTerm={highlightTerm} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export { Typeahead };
