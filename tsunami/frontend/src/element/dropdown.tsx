// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useRef, useEffect } from 'react';
import { twMerge } from 'tailwind-merge';

export interface DropdownOption {
    label: string;
    value: string;
    disabled?: boolean;
}

export interface DropdownProps {
    options?: DropdownOption[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    style?: React.CSSProperties;
    className?: string;
    onChange?: (value: string) => void;
}

export function Dropdown({ 
    options = [], 
    value, 
    placeholder = "Select an option...", 
    disabled = false, 
    style, 
    className,
    onChange
}: DropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Find the selected option
    const selectedOption = options.find(opt => opt.value === value);
    const displayText = selectedOption ? selectedOption.label : placeholder;

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setHighlightedIndex(-1);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
                setHighlightedIndex(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIndex(prev => {
                    const nextIndex = prev + 1;
                    // Skip disabled options
                    for (let i = nextIndex; i < options.length; i++) {
                        if (!options[i].disabled) return i;
                    }
                    return prev;
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIndex(prev => {
                    const nextIndex = prev - 1;
                    // Skip disabled options
                    for (let i = nextIndex; i >= 0; i--) {
                        if (!options[i].disabled) return i;
                    }
                    return prev;
                });
            } else if (e.key === 'Enter' && highlightedIndex >= 0) {
                e.preventDefault();
                const option = options[highlightedIndex];
                if (!option.disabled) {
                    handleSelect(option);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, highlightedIndex, options]);

    const handleSelect = (option: DropdownOption) => {
        if (option.disabled) return;
        setIsOpen(false);
        setHighlightedIndex(-1);
        if (onChange) {
            onChange(option.value);
        }
    };

    const toggleDropdown = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
            if (!isOpen) {
                // When opening, highlight the selected item or first enabled item
                const selectedIndex = options.findIndex(opt => opt.value === value);
                if (selectedIndex >= 0 && !options[selectedIndex].disabled) {
                    setHighlightedIndex(selectedIndex);
                } else {
                    const firstEnabled = options.findIndex(opt => !opt.disabled);
                    setHighlightedIndex(firstEnabled);
                }
            } else {
                setHighlightedIndex(-1);
            }
        }
    };

    const triggerClasses = twMerge(
        "w-full px-3 py-2 rounded border bg-gray-800 text-gray-200 border-gray-700",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
        "cursor-pointer flex items-center justify-between gap-2",
        "hover:bg-gray-750 transition-colors",
        disabled && "cursor-not-allowed opacity-50 hover:bg-gray-800",
        className
    );

    const menuClasses = twMerge(
        "absolute z-50 w-full mt-1 rounded border border-gray-700 bg-gray-800",
        "shadow-xl max-h-60 overflow-auto"
    );

    const optionClasses = (option: DropdownOption, index: number) => twMerge(
        "px-3 py-2 cursor-pointer transition-colors text-sm",
        option.disabled ? "opacity-50 cursor-not-allowed text-gray-500" : "text-gray-200 hover:bg-gray-700",
        highlightedIndex === index && !option.disabled && "bg-gray-700",
        option.value === value && "bg-gray-750 font-semibold"
    );

    return (
        <div ref={dropdownRef} className="relative w-full" style={style}>
            <button
                type="button"
                className={triggerClasses}
                onClick={toggleDropdown}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className={!selectedOption ? "text-gray-400" : "flex-1 text-left"}>
                    {displayText}
                </span>
                <svg 
                    className={`w-4 h-4 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className={menuClasses} role="listbox">
                    {options.length === 0 ? (
                        <div className="px-3 py-2 text-gray-500 text-sm">No options available</div>
                    ) : (
                        options.map((option, index) => (
                            <div
                                key={`${option.value}-${index}`}
                                className={optionClasses(option, index)}
                                onClick={() => handleSelect(option)}
                                onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                                role="option"
                                aria-selected={option.value === value}
                                aria-disabled={option.disabled}
                            >
                                {option.label}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
