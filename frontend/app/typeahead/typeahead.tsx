// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import React, { ReactNode, useEffect, useId, useRef, useState } from "react";

interface TypeaheadProps {
    anchorRef: React.RefObject<HTMLElement>;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: SuggestionType, queryStr: string) => void;
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

const TypeaheadInner: React.FC<Omit<TypeaheadProps, "isOpen">> = ({
    anchorRef,
    onClose,
    onSelect,
    fetchSuggestions,
    className,
}) => {
    const widgetId = useId();
    const [query, setQuery] = useState("");
    const reqNumRef = useRef(0);
    const [suggestions, setSuggestions] = useState<SuggestionType[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [fetched, setFetched] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { refs, floatingStyles } = useFloating({
        placement: "bottom",
        strategy: "absolute",
        middleware: [offset(5)],
    });

    useEffect(() => {
        if (anchorRef.current == null) {
            refs.setReference(null);
            return;
        }
        const headerElem = anchorRef.current.querySelector("[data-role='block-header']");
        refs.setReference(headerElem);
    }, [anchorRef.current]);

    useEffect(() => {
        reqNumRef.current++;
        fetchSuggestions(query, { widgetid: widgetId, reqnum: reqNumRef.current }).then((results) => {
            if (results.reqnum != reqNumRef.current) {
                return;
            }
            setSuggestions(results.suggestions);
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
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                anchorRef.current &&
                !anchorRef.current.contains(event.target as Node)
            ) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose, anchorRef]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
            e.preventDefault();
        } else if (e.key === "ArrowUp") {
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
            e.preventDefault();
        } else if (e.key === "Enter" && selectedIndex >= 0) {
            onSelect(suggestions[selectedIndex], query);
            onClose();
        } else if (e.key === "Escape") {
            onClose();
        }
    };

    console.log("rendering suggestions", suggestions);

    return (
        <div
            className={clsx(
                "w-96 rounded-lg bg-gray-800 shadow-lg border border-gray-700 z-[var(--zindex-typeahead-modal)]",
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
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-gray-900 text-gray-100 px-4 py-2 rounded-md 
                             border border-gray-700 focus:outline-none focus:border-blue-500
                             placeholder-gray-500"
                    placeholder="Search files..."
                />
            </div>
            {fetched && suggestions.length > 0 && (
                <div ref={dropdownRef} className="max-h-96 overflow-y-auto divide-y divide-gray-700">
                    {suggestions.map((suggestion, index) => (
                        <div
                            key={suggestion.suggestionid}
                            className={clsx(
                                "flex items-center gap-3 px-4 py-2 cursor-pointer",
                                "hover:bg-gray-700",
                                index === selectedIndex ? "bg-gray-700" : "",
                                "text-gray-100"
                            )}
                            onClick={() => {
                                onSelect(suggestion, query);
                                onClose();
                            }}
                        >
                            <i
                                className={clsx(
                                    makeIconClass(suggestion.icon, true, { defaultIcon: "file" }),
                                    "text-lg"
                                )}
                                style={{ color: suggestion.iconcolor }}
                            />
                            <span className="truncate">{defaultHighlighter(suggestion["file:name"], query)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export { Typeahead };
