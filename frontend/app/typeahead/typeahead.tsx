// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { offset, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

interface Suggestion {
    type: "file";
    suggestionid: string;
    filename: string;
    filepath: string;
    icon: string;
    iconcolor: string;
    mimetype: string;
}

interface TypeaheadProps {
    anchorRef: React.RefObject<HTMLElement>;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: Suggestion, queryStr: string) => void;
    fetchSuggestions: (query: string) => Promise<Suggestion[]>;
    className?: string;
}

const Typeahead: React.FC<TypeaheadProps> = ({ anchorRef, isOpen, onClose, onSelect, fetchSuggestions, className }) => {
    console.log("TYPEAHEAD", anchorRef, isOpen, onClose, onSelect, fetchSuggestions, className);
    if (!isOpen || !anchorRef.current || !fetchSuggestions) return null;

    return <TypeaheadInner {...{ anchorRef, onClose, onSelect, fetchSuggestions, className }} />;
};

const TypeaheadInner: React.FC<Omit<TypeaheadProps, "isOpen">> = ({
    anchorRef,
    onClose,
    onSelect,
    fetchSuggestions,
    className,
}) => {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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
        fetchSuggestions(query).then((results) => {
            setSuggestions(results);
            setFetched(true);
        });
    }, [query, fetchSuggestions]);

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

    console.log("SUGGESTIONS-LEN", suggestions.length);

    return (
        <div
            className={clsx("typeahead-container z-[var(--zindex-typeahead-modal)]", className)}
            ref={refs.setFloating}
            style={floatingStyles}
        >
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="typeahead-input"
                placeholder="Search files..."
            />
            {fetched && suggestions.length > 0 && (
                <div className="typeahead-dropdown">
                    {suggestions.map((suggestion, index) => (
                        <div
                            key={suggestion.suggestionid}
                            className={clsx("typeahead-item", { selected: index === selectedIndex })}
                            onClick={() => {
                                onSelect(suggestion, query);
                                onClose();
                            }}
                        >
                            <i className={suggestion.icon} style={{ color: suggestion.iconcolor }}></i>
                            <span>{suggestion.filename}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export { Typeahead };
export type { Suggestion };
