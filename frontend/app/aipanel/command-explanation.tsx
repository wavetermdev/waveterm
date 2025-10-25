// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Spin, Card, Tag, Typography, Button, Tooltip, Divider } from "antd";
import {
    CloseOutlined,
    InfoCircleOutlined,
    CodeOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    BookOutlined
} from "@ant-design/icons";
import { CommandExplanation } from "./aitypes";

const { Title, Text, Paragraph } = Typography;

interface CommandExplanationProps {
    explanation: CommandExplanation | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
}

export const CommandExplanationComponent: React.FC<CommandExplanationProps> = ({
    explanation,
    loading,
    error,
    onClose
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && explanation) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [explanation, onClose]);

    // Focus management
    useEffect(() => {
        if (explanation && containerRef.current) {
            containerRef.current.focus();
        }
    }, [explanation]);

    if (!explanation && !loading && !error) {
        return null;
    }

    const getDifficultyColor = (difficulty: string) => {
        switch (difficulty) {
            case "beginner":
                return "green";
            case "intermediate":
                return "orange";
            case "advanced":
                return "red";
            default:
                return "default";
        }
    };

    return (
        <div className="command-explanation-overlay">
            <div className="explanation-backdrop" onClick={onClose} />
            <div
                className="explanation-container"
                ref={containerRef}
                tabIndex={0}
                role="region"
                aria-label="Command explanation"
            >
                <Card
                    className="explanation-card"
                    title={
                        <div className="explanation-header">
                            <InfoCircleOutlined />
                            <span>Command Explanation</span>
                            <Button
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={onClose}
                                className="explanation-close"
                            />
                        </div>
                    }
                >
                    {loading ? (
                        <div className="explanation-loading">
                            <Spin size="large" />
                            <Text>Analyzing command...</Text>
                        </div>
                    ) : error ? (
                        <div className="explanation-error">
                            <WarningOutlined />
                            <Text type="danger">{error}</Text>
                            <Button onClick={onClose}>Close</Button>
                        </div>
                    ) : explanation ? (
                        <div className="explanation-content">
                            <div className="explanation-command">
                                <CodeOutlined />
                                <Text code className="command-text">
                                    {explanation.command}
                                </Text>
                                <Tag color={getDifficultyColor(explanation.difficulty)}>
                                    {explanation.difficulty}
                                </Tag>
                            </div>

                            <Divider />

                            <div className="explanation-purpose">
                                <Title level={4}>Purpose</Title>
                                <Paragraph>{explanation.purpose}</Paragraph>
                            </div>

                            <div className="explanation-syntax">
                                <Title level={4}>Syntax</Title>
                                <Text code className="syntax-text">
                                    {explanation.syntax}
                                </Text>
                            </div>

                            {Object.keys(explanation.options).length > 0 && (
                                <div className="explanation-options">
                                    <Title level={4}>Options</Title>
                                    <div className="options-list">
                                        {Object.entries(explanation.options).map(([option, info]) => (
                                            <div key={option} className="option-item">
                                                <Text code className="option-name">
                                                    {option}
                                                </Text>
                                                <Text className="option-description">
                                                    {info.description}
                                                </Text>
                                                <Text code className="option-example">
                                                    {info.example}
                                                </Text>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="explanation-examples">
                                <Title level={4}>Examples</Title>
                                <div className="examples-list">
                                    {explanation.examples.map((example, index) => (
                                        <div key={index} className="example-item">
                                            <div className="example-command">
                                                <Text code>$ {example.command}</Text>
                                            </div>
                                            <div className="example-description">
                                                <Text>{example.description}</Text>
                                            </div>
                                            {example.output && (
                                                <div className="example-output">
                                                    <Text type="secondary">
                                                        Output: {example.output}
                                                    </Text>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {explanation.warnings.length > 0 && (
                                <div className="explanation-warnings">
                                    <Title level={4}>Warnings</Title>
                                    <div className="warnings-list">
                                        {explanation.warnings.map((warning, index) => (
                                            <div key={index} className="warning-item">
                                                <WarningOutlined />
                                                <Text type="warning">{warning}</Text>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="explanation-related">
                                <Title level={4}>Related Commands</Title>
                                <div className="related-commands">
                                    {explanation.relatedCommands.map((cmd, index) => (
                                        <Tag key={index} className="related-command">
                                            {cmd}
                                        </Tag>
                                    ))}
                                </div>
                            </div>

                            <Divider />

                            <div className="explanation-footer">
                                <Text type="secondary">
                                    Explanation generated by AI • Press Esc to close
                                </Text>
                                <div className="explanation-actions">
                                    <Tooltip title="Add to favorites">
                                        <Button icon={<BookOutlined />} size="small">
                                            Save
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="Copy explanation">
                                        <Button size="small">Copy</Button>
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </Card>
            </div>
        </div>
    );
};

export default CommandExplanationComponent;
