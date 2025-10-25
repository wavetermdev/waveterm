// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { useAtomValue } from "jotai";
import React, { memo, useState } from "react";
import {
    RobotOutlined,
    ThunderboltOutlined,
    SecurityScanOutlined,
    DatabaseOutlined,
    SettingOutlined,
    InfoCircleOutlined,
    EyeOutlined,
    ApiOutlined,
    BulbOutlined
} from "@ant-design/icons";
import { Button, Tooltip, Badge, Switch, Dropdown, Space } from "antd";
import { WaveAIModel } from "./waveai-model";
import { agentCoordinator } from "./agent-coordinator";

interface AIPanelHeaderProps {
    onClose?: () => void;
    model: WaveAIModel;
    onClearChat?: () => void;
}

export const AIPanelHeader = memo(({ onClose, model, onClearChat }: AIPanelHeaderProps) => {
    const widgetAccess = useAtomValue(model.widgetAccessAtom);
    const [hyperIntelligentMode, setHyperIntelligentMode] = useState(false);
    const [contextVisualizerVisible, setContextVisualizerVisible] = useState(false);
    const [securityMonitorVisible, setSecurityMonitorVisible] = useState(false);
    const [aiSettingsVisible, setAiSettingsVisible] = useState(false);

    // Get agent status for display
    const agents = agentCoordinator.getAllAgents();
    const activeAgents = agents.filter(a => a.status === "active").length;
    const processingAgents = agents.filter(a => a.status === "processing").length;

    const handleKebabClick = (e: React.MouseEvent) => {
        const menu: ContextMenuItem[] = [
            {
                label: "New Chat",
                click: () => {
                    onClearChat?.();
                },
            },
            {
                label: "Clear AI Agents",
                click: () => {
                    // Reset all agents
                    agents.forEach(agent => {
                        agentCoordinator.updateAgentContext(agent.id, {
                            ...agent.context,
                            performance: { responseTime: 0, accuracy: 0, reliability: 0 }
                        });
                    });
                },
            },
            { type: "separator" },
            {
                label: "Hide Wave AI",
                click: () => {
                    onClose?.();
                },
            },
        ];
        ContextMenuModel.showContextMenu(menu, e);
    };

    const handleHyperIntelligentToggle = (checked: boolean) => {
        setHyperIntelligentMode(checked);

        if (checked) {
            // Initialize hyper-intelligent mode
            agentCoordinator.updateContext({
                sessionId: "hyper-intelligent",
                tabId: "main",
                workingDirectory: process.cwd(),
                recentCommands: [],
                environmentVariables: process.env,
                shellType: process.platform === 'win32' ? 'powershell' : 'bash',
                sharedContext: {
                    systemMode: "hyper-intelligent",
                    optimizationLevel: "maximum",
                    securityLevel: "high"
                },
                performance: { responseTime: 0, accuracy: 0, reliability: 0 }
            });
        }
    };

    const aiActionMenuItems = [
        {
            key: "context",
            icon: <DatabaseOutlined />,
            label: "Context Visualizer",
            onClick: () => setContextVisualizerVisible(true)
        },
        {
            key: "security",
            icon: <SecurityScanOutlined />,
            label: "Security Monitor",
            onClick: () => setSecurityMonitorVisible(true)
        },
        {
            key: "settings",
            icon: <SettingOutlined />,
            label: "AI Settings",
            onClick: () => setAiSettingsVisible(true)
        },
        {
            key: "agents",
            icon: <RobotOutlined />,
            label: "Agent Status",
            onClick: () => {
                const agentStatus = agents.map(agent =>
                    `${agent.name}: ${agent.status} (${agent.context.performance.accuracy.toFixed(1)}% accuracy)`
                ).join('\n');
                alert(`AI Agent Status:\n\n${agentStatus}`);
            }
        }
    ];

    return (
        <div className="@container py-2 pl-3 pr-1 @xs:p-2 @xs:pl-4 border-b border-gray-600 flex items-center justify-between min-w-0">
            <div className="flex items-center gap-3 flex-shrink-0">
                <h2 className="text-white text-sm @xs:text-lg font-semibold flex items-center gap-2 whitespace-nowrap">
                    <i className="fa fa-sparkles text-accent"></i>
                    {hyperIntelligentMode ? "Hyper AI Terminal" : "Wave AI"}
                </h2>

                {/* Agent Status Indicators */}
                <div className="flex items-center gap-2">
                    <Tooltip title={`${activeAgents} agents active, ${processingAgents} processing`}>
                        <Badge count={activeAgents} showZero={false} size="small">
                            <RobotOutlined className="text-accent" />
                        </Badge>
                    </Tooltip>

                    {processingAgents > 0 && (
                        <Tooltip title={`${processingAgents} agents processing`}>
                            <ThunderboltOutlined className="text-blue-400 animate-pulse" />
                        </Tooltip>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Hyper-Intelligent Mode Toggle */}
                <Tooltip title="Enable Hyper-Intelligent Terminal with Multi-Agent System">
                    <div className="flex items-center gap-1">
                        <span className="text-gray-300 text-[10px] hidden @md:inline">Hyper AI</span>
                        <Switch
                            checked={hyperIntelligentMode}
                            onChange={handleHyperIntelligentToggle}
                            size="small"
                            className="hyper-intelligent-toggle"
                        />
                    </div>
                </Tooltip>

                {/* Widget Context Toggle */}
                <div className="flex items-center text-sm">
                    <span className="text-gray-300 @xs:hidden mr-1 text-[12px]">Context</span>
                    <span className="text-gray-300 hidden @xs:inline mr-2 text-[12px]">Widget Context</span>
                    <button
                        onClick={() => {
                            model.setWidgetAccess(!widgetAccess);
                            setTimeout(() => {
                                model.focusInput();
                            }, 0);
                        }}
                        className={`relative inline-flex h-6 w-14 items-center rounded-full transition-colors cursor-pointer ${
                            widgetAccess ? "bg-accent-500" : "bg-gray-600"
                        }`}
                        title={`Widget Access ${widgetAccess ? "ON" : "OFF"}`}
                    >
                        <span
                            className={`absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                widgetAccess ? "translate-x-8" : "translate-x-1"
                            }`}
                        />
                        <span
                            className={`relative z-10 text-xs text-white transition-all ${
                                widgetAccess ? "ml-2.5 mr-6 text-left font-bold" : "ml-6 mr-1 text-right"
                            }`}
                        >
                            {widgetAccess ? "ON" : "OFF"}
                        </span>
                    </button>
                </div>

                {/* AI Actions Dropdown */}
                <Dropdown
                    menu={{
                        items: aiActionMenuItems,
                        onClick: ({ key }) => {
                            const item = aiActionMenuItems.find(i => i.key === key);
                            if (item?.onClick) item.onClick();
                        }
                    }}
                    trigger={["click"]}
                >
                    <Button
                        type="text"
                        icon={<BulbOutlined />}
                        size="small"
                        className="text-gray-400 hover:text-white transition-colors"
                        title="AI Actions"
                    />
                </Dropdown>

                {/* More Options */}
                <button
                    onClick={handleKebabClick}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 focus:outline-none"
                    title="More options"
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
