// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from "react";
import { Card, Tabs, Typography, Button, Table, Tag, Tooltip, Progress, Statistic } from "antd";
import {
    DatabaseOutlined,
    ShareAltOutlined,
    CloseOutlined,
    SyncOutlined,
    InfoCircleOutlined,
    BarChartOutlined,
    RobotOutlined,
    SecurityScanOutlined,
    ThunderboltOutlined,
    ApiOutlined
} from "@ant-design/icons";
import { AIAgent, AgentContext, OptimizationMetrics } from "./aitypes";
import { agentCoordinator } from "./agent-coordinator";

const { Title, Text } = Typography;
const { TabPane } = Tabs;

interface ContextVisualizerProps {
    isVisible: boolean;
    onClose: () => void;
}

export const ContextVisualizer: React.FC<ContextVisualizerProps> = ({
    isVisible,
    onClose
}) => {
    const [agents, setAgents] = useState<AIAgent[]>([]);
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
    const [metrics, setMetrics] = useState<OptimizationMetrics | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Load agents and metrics
    useEffect(() => {
        if (isVisible) {
            loadAgents();
            loadMetrics();
        }
    }, [isVisible]);

    const loadAgents = () => {
        const allAgents = agentCoordinator.getAllAgents();
        setAgents(allAgents);
    };

    const loadMetrics = async () => {
        setRefreshing(true);
        try {
            // Request optimization metrics from the optimization agent
            const context: AgentContext = {
                sessionId: "current",
                tabId: "main",
                workingDirectory: process.cwd(),
                recentCommands: [],
                environmentVariables: process.env,
                shellType: "bash",
                sharedContext: {},
                performance: { responseTime: 0, accuracy: 0, reliability: 0 }
            };

            // This would trigger the optimization agent to generate metrics
            await agentCoordinator.requestCommandAnalysis("system_metrics", context);
        } catch (error) {
            console.error("Error loading metrics:", error);
        } finally {
            setRefreshing(false);
        }
    };

    const getAgentIcon = (agentType: string) => {
        switch (agentType) {
            case "command_analysis":
                return <CodeOutlined />;
            case "context_manager":
                return <DatabaseOutlined />;
            case "command_explanation":
                return <InfoCircleOutlined />;
            case "pattern_analysis":
                return <BarChartOutlined />;
            case "security_monitor":
                return <SecurityScanOutlined />;
            case "optimization_engine":
                return <ThunderboltOutlined />;
            case "mcp_integration":
                return <ApiOutlined />;
            case "coordinator":
                return <ShareAltOutlined />;
            default:
                return <RobotOutlined />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case "active":
                return "green";
            case "processing":
                return "blue";
            case "idle":
                return "default";
            case "error":
                return "red";
            case "disabled":
                return "gray";
            default:
                return "default";
        }
    };

    const agentsTableColumns = [
        {
            title: "Agent",
            dataIndex: "name",
            key: "name",
            render: (name: string, agent: AIAgent) => (
                <div className="agent-row">
                    <div className="agent-icon">
                        {getAgentIcon(agent.type)}
                    </div>
                    <div className="agent-info">
                        <div className="agent-name">{name}</div>
                        <div className="agent-type">{agent.type.replace("_", " ")}</div>
                    </div>
                </div>
            )
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status: string) => (
                <Tag color={getStatusColor(status)}>
                    {status}
                </Tag>
            )
        },
        {
            title: "Performance",
            dataIndex: "context",
            key: "performance",
            render: (context: AgentContext) => (
                <div className="performance-indicators">
                    <Tooltip title={`Response Time: ${context.performance.responseTime}ms`}>
                        <Progress
                            percent={Math.max(0, 100 - context.performance.responseTime / 10)}
                            size="small"
                            showInfo={false}
                            strokeColor={context.performance.responseTime < 500 ? "#52c41a" : "#faad14"}
                        />
                    </Tooltip>
                    <Text className="performance-text">
                        {context.performance.accuracy.toFixed(1)}%
                    </Text>
                </div>
            )
        },
        {
            title: "Capabilities",
            dataIndex: "capabilities",
            key: "capabilities",
            render: (capabilities: string[]) => (
                <div className="capabilities-list">
                    {capabilities.slice(0, 2).map(cap => (
                        <Tag key={cap} size="small">
                            {cap.replace("_", " ")}
                        </Tag>
                    ))}
                    {capabilities.length > 2 && (
                        <Tag size="small">+{capabilities.length - 2}</Tag>
                    )}
                </div>
            )
        }
    ];

    const metricsColumns = [
        {
            title: "Metric",
            dataIndex: "name",
            key: "name"
        },
        {
            title: "Value",
            dataIndex: "value",
            key: "value",
            render: (value: any, record: any) => (
                <div className="metric-display">
                    <Statistic
                        value={value}
                        suffix={record.unit}
                        precision={record.precision || 1}
                        valueStyle={{ fontSize: "14px" }}
                    />
                </div>
            )
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status: string) => (
                <Tag color={status === "good" ? "green" : status === "warning" ? "orange" : "red"}>
                    {status}
                </Tag>
            )
        }
    ];

    const prepareMetricsData = (metrics: OptimizationMetrics | null) => {
        if (!metrics) return [];

        return [
            {
                key: "response-time",
                name: "Response Time",
                value: metrics.performance.responseTime,
                unit: "ms",
                precision: 0,
                status: metrics.performance.responseTime < 500 ? "good" : "warning"
            },
            {
                key: "throughput",
                name: "Throughput",
                value: metrics.performance.throughput,
                unit: "%",
                precision: 1,
                status: metrics.performance.throughput > 80 ? "good" : "warning"
            },
            {
                key: "efficiency",
                name: "Efficiency",
                value: metrics.performance.efficiency,
                unit: "%",
                precision: 1,
                status: metrics.performance.efficiency > 75 ? "good" : "warning"
            },
            {
                key: "uptime",
                name: "Uptime",
                value: metrics.reliability.uptime,
                unit: "%",
                precision: 2,
                status: metrics.reliability.uptime > 99 ? "good" : "warning"
            },
            {
                key: "error-rate",
                name: "Error Rate",
                value: metrics.reliability.errorRate,
                unit: "%",
                precision: 2,
                status: metrics.reliability.errorRate < 1 ? "good" : "warning"
            },
            {
                key: "memory",
                name: "Memory Usage",
                value: metrics.resourceUsage.memory,
                unit: "%",
                precision: 1,
                status: metrics.resourceUsage.memory < 70 ? "good" : "warning"
            },
            {
                key: "cpu",
                name: "CPU Usage",
                value: metrics.resourceUsage.cpu,
                unit: "%",
                precision: 1,
                status: metrics.resourceUsage.cpu < 60 ? "good" : "warning"
            }
        ];
    };

    if (!isVisible) return null;

    return (
        <div className="context-visualizer-overlay">
            <div className="visualizer-backdrop" onClick={onClose} />
            <div className="visualizer-container">
                <Card
                    className="visualizer-card"
                    title={
                        <div className="visualizer-header">
                            <DatabaseOutlined />
                            <span>AI Agent Context Visualizer</span>
                            <Button
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={onClose}
                                className="visualizer-close"
                            />
                        </div>
                    }
                    extra={
                        <Button
                            icon={<SyncOutlined spin={refreshing} />}
                            onClick={loadMetrics}
                            loading={refreshing}
                        >
                            Refresh
                        </Button>
                    }
                >
                    <Tabs defaultActiveKey="agents" className="visualizer-tabs">
                        <TabPane tab="Agents" key="agents">
                            <div className="agents-section">
                                <div className="agents-summary">
                                    <Statistic
                                        title="Active Agents"
                                        value={agents.filter(a => a.status === "active").length}
                                        suffix={`/ ${agents.length}`}
                                    />
                                    <Statistic
                                        title="Processing"
                                        value={agents.filter(a => a.status === "processing").length}
                                        suffix="agents"
                                    />
                                    <Statistic
                                        title="Avg Response"
                                        value={agents.reduce((sum, a) => sum + a.context.performance.responseTime, 0) / agents.length}
                                        suffix="ms"
                                        precision={0}
                                    />
                                </div>
                                <Table
                                    dataSource={agents}
                                    columns={agentsTableColumns}
                                    rowKey="id"
                                    size="small"
                                    pagination={false}
                                    onRow={(agent) => ({
                                        onClick: () => setSelectedAgent(agent.id),
                                        style: { cursor: "pointer" }
                                    })}
                                    rowClassName={(agent) =>
                                        selectedAgent === agent.id ? "selected-agent" : ""
                                    }
                                />
                            </div>
                        </TabPane>

                        <TabPane tab="Performance" key="performance">
                            <div className="performance-section">
                                {metrics ? (
                                    <Table
                                        dataSource={prepareMetricsData(metrics)}
                                        columns={metricsColumns}
                                        rowKey="key"
                                        size="small"
                                        pagination={false}
                                    />
                                ) : (
                                    <div className="no-metrics">
                                        <BarChartOutlined />
                                        <Text>No metrics available</Text>
                                        <Button onClick={loadMetrics} loading={refreshing}>
                                            Load Metrics
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </TabPane>

                        <TabPane tab="Context" key="context">
                            <div className="context-section">
                                <div className="context-info">
                                    <Card title="Current Session" size="small">
                                        <div className="context-details">
                                            <div className="context-item">
                                                <Text strong>Working Directory:</Text>
                                                <Text code>{process.cwd()}</Text>
                                            </div>
                                            <div className="context-item">
                                                <Text strong>Shell:</Text>
                                                <Text>{process.platform === 'win32' ? 'PowerShell' : 'Bash'}</Text>
                                            </div>
                                            <div className="context-item">
                                                <Text strong>Active Tab:</Text>
                                                <Text>main</Text>
                                            </div>
                                        </div>
                                    </Card>
                                </div>
                            </div>
                        </TabPane>
                    </Tabs>
                </Card>
            </div>
        </div>
    );
};

export default ContextVisualizer;
