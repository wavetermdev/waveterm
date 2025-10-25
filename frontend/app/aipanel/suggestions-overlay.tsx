// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useCallback, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
    FileOutlined,
    FolderOutlined,
    CodeOutlined,
    BranchesOutlined,
    TagOutlined,
    RobotOutlined,
    HistoryOutlined,
    ToolOutlined,
    ApiOutlined,
    FormatPainterOutlined,
    CloseOutlined,
    CheckCircleOutlined
} from "@ant-design/icons";
import { agentCoordinator } from "./agent-coordinator";
import { CommandSuggestion, AgentContext } from "./aitypes";
import * as jotai from "jotai";

interface SuggestionsOverlayProps {
    isVisible: boolean;
    command: string;
    cursorPosition: number;
    context: AgentContext;
    onSuggestionSelect: (suggestion: string) => void;
    onClose: () => void;
}

export const SuggestionsOverlay: React.FC<SuggestionsOverlayProps> = ({
    isVisible,
    command,
    cursorPosition,
    context,
    onSuggestionSelect,
    onClose
}) => {
    const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(false);

    // Get suggestion icon based on type
    const getSuggestionIcon = (suggestion: CommandSuggestion) => {
        switch (suggestion.type) {
            case "completion":
                return <CodeOutlined className="suggestion-icon completion-icon" />;
            case "correction":
                return <CheckCircleOutlined className="suggestion-icon correction-icon" />;
            case "optimization":
                return <ToolOutlined className="suggestion-icon optimization-icon" />;
            case "alternative":
                return <ApiOutlined className="suggestion-icon alternative-icon" />;
            default:
                return <CodeOutlined className="suggestion-icon default-icon" />;
        }
    };

    // Load suggestions when command changes
    useEffect(() => {
        if (isVisible && command.trim()) {
            loadSuggestions();
        } else {
            setSuggestions([]);
        }
    }, [isVisible, command, context]);

    const loadSuggestions = async () => {
        setLoading(true);
        try {
            const analysis = await agentCoordinator.requestCommandAnalysis(command, context);
            if (analysis.suggestions) {
                setSuggestions(analysis.suggestions);
            }
        } catch (error) {
            console.error("Error loading suggestions:", error);
        } finally {
            setLoading(false);
        }
    };

    // Handle keyboard navigation
    useEffect(() => {
        if (!isVisible) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex(prev =>
                        prev < suggestions.length - 1 ? prev + 1 : prev
                    );
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
                    break;
                case "Enter":
                    e.preventDefault();
                    if (suggestions[selectedIndex]) {
                        onSuggestionSelect(suggestions[selectedIndex].command);
                        onClose();
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    onClose();
                    break;
                case "Tab":
                    e.preventDefault();
                    if (suggestions[selectedIndex]) {
                        onSuggestionSelect(suggestions[selectedIndex].command);
                        onClose();
                    }
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isVisible, suggestions, selectedIndex, onSuggestionSelect, onClose]);

    if (!isVisible) return null;

    return (
        <div className="suggestions-overlay">
            <div className="suggestions-container">
                <div className="suggestions-header">
                    <div className="suggestions-title">
                        <RobotOutlined />
                        <span>AI Command Suggestions</span>
                    </div>
                    <button className="suggestions-close" onClick={onClose}>
                        <CloseOutlined />
                    </button>
                </div>

                {loading ? (
                    <div className="suggestions-loading">
                        <div className="loading-spinner" />
                        <span>Analyzing command...</span>
                    </div>
                ) : suggestions.length > 0 ? (
                    <div className="suggestions-list">
                        {suggestions.map((suggestion, index) => (
                            <div
                                key={index}
                                className={`suggestion-item ${
                                    index === selectedIndex ? "selected" : ""
                                }`}
                                onClick={() => {
                                    onSuggestionSelect(suggestion.command);
                                    onClose();
                                }}
                            >
                                <div className="suggestion-icon">
                                    {getSuggestionIcon(suggestion)}
                                </div>
                                <div className="suggestion-content">
                                    <div className="suggestion-command">
                                        {suggestion.command}
                                    </div>
                                    <div className="suggestion-description">
                                        {suggestion.description}
                                    </div>
                                    <div className="suggestion-meta">
                                        <span className="suggestion-confidence">
                                            {Math.round(suggestion.confidence * 100)}% confidence
                                        </span>
                                        <span className="suggestion-type">
                                            {suggestion.type}
                                        </span>
                                    </div>
                                </div>
                                {suggestion.examples.length > 0 && (
                                    <div className="suggestion-examples">
                                        {suggestion.examples.slice(0, 2).map((example, i) => (
                                            <div key={i} className="example-item">
                                                {example}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="suggestions-empty">
                        <div className="empty-icon">
                            <CodeOutlined />
                        </div>
                        <div className="empty-text">
                            No suggestions available for "{command}"
                        </div>
                        <div className="empty-hint">
                            Try typing a more specific command or use Ctrl+/ for explanations
                        </div>
                    </div>
                )}

                {suggestions.length > 0 && (
                    <div className="suggestions-footer">
                        <div className="suggestions-shortcuts">
                            <span>↑↓ Navigate</span>
                            <span>Enter/Tab Select</span>
                            <span>Esc Close</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SuggestionsOverlay;
