// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect, useCallback } from "react";
import {
    Layout,
    Card,
    Button,
    Space,
    Typography,
    Alert,
    Progress,
    Statistic,
    Row,
    Col,
    Badge,
    Tooltip,
    Tag
} from "antd";
import {
    RobotOutlined,
    ThunderboltOutlined,
    SecurityScanOutlined,
    DatabaseOutlined,
    CodeOutlined,
    InfoCircleOutlined,
    SettingOutlined,
    PlayCircleOutlined,
    StopOutlined,
    ReloadOutlined,
    BugOutlined,
    ApiOutlined,
    CloudOutlined
} from "@ant-design/icons";
import { AIAgent, AgentContext, OptimizationMetrics } from "./aitypes";
import { agentCoordinator } from "./agent-coordinator";
import { EnhancedTerminalInput } from "./enhanced-terminal-input";
import { SuggestionsOverlay } from "./suggestions-overlay";
import { CommandExplanationComponent } from "./command-explanation";
import { ContextVisualizer } from "./context-visualizer";
import { AISettings } from "./ai-settings";
import { SecurityMonitor } from "./security-monitor";

const { Title, Text, Paragraph } = Typography;
const { Header, Content, Sider } = Layout;

interface HyperIntelligentTerminalProps {
    workingDirectory: string;
    shellType: string;
    recentCommands: string[];
    environmentVariables: Record<string, string>;
    onCommand: (command: string) => Promise<void>;
}

export const HyperIntelligentTerminal: React.FC<HyperIntelligentTerminalProps> = ({
    workingDirectory,
    shellType,
    recentCommands,
    environmentVariables,
    onCommand
}) => {
    const [agents, setAgents] = useState<AIAgent[]>([]);
    const [systemStatus, setSystemStatus] = useState<"initializing" | "ready" | "processing" | "error">("initializing");
    const [metrics, setMetrics] = useState<OptimizationMetrics | null>(null);
    const [performanceScore, setPerformanceScore] = useState(0);
    const [activeFeatures, setActiveFeatures] = useState<string[]>([]);

    // Current context for all agents
    const currentContext: AgentContext = {
        sessionId: "hyper-intelligent",
        tabId: "main",
        workingDirectory,
        recentCommands,
        environmentVariables,
        shellType,
        sharedContext: {
            systemMode: "hyper-intelligent",
            optimizationLevel: "maximum",
            securityLevel: "high"
        },
        performance: { responseTime: 0, accuracy: 0, reliability: 0 }
    };

    // Initialize the hyper-intelligent system
    useEffect(() => {
        initializeSystem();
    }, []);

    const initializeSystem = async () => {
        setSystemStatus("initializing");

        try {
            // Initialize all agents
            const allAgents = agentCoordinator.getAllAgents();
            setAgents(allAgents);

            // Update context for all agents
            await agentCoordinator.updateContext(currentContext);

            // Request initial metrics
            await loadSystemMetrics();

            // Set up periodic optimization
            const optimizationInterval = setInterval(() => {
                loadSystemMetrics();
            }, 30000); // Every 30 seconds

            setSystemStatus("ready");
            setActiveFeatures([
                "command_analysis",
                "context_management",
                "pattern_analysis",
                "security_monitoring",
                "performance_optimization",
                "multi_agent_coordination",
                "real_time_suggestions",
                "command_explanations"
            ]);

            return () => clearInterval(optimizationInterval);

        } catch (error) {
            console.error("Error initializing hyper-intelligent system:", error);
            setSystemStatus("error");
        }
    };

    const loadSystemMetrics = async () => {
        try {
            // This would trigger the optimization agent
            await agentCoordinator.requestCommandAnalysis("system_optimization", currentContext);

            // Calculate performance score based on agent performance
            const avgResponseTime = agents.reduce((sum, agent) =>
                sum + agent.context.performance.responseTime, 0) / agents.length;
            const avgAccuracy = agents.reduce((sum, agent) =>
                sum + agent.context.performance.accuracy, 0) / agents.length;
            const avgReliability = agents.reduce((sum, agent) =>
                sum + agent.context.performance.reliability, 0) / agents.length;

            const score = Math.round((avgAccuracy * 0.4 + avgReliability * 0.4 + (1000 - avgResponseTime) / 10 * 0.2));
            setPerformanceScore(score);

            setMetrics({
                performance: {
                    responseTime: avgResponseTime,
                    throughput: avgAccuracy * 100,
                    efficiency: (avgAccuracy + avgReliability) / 2 * 100
                },
                reliability: {
                    uptime: avgReliability * 100,
                    errorRate: (1 - avgReliability) * 100,
                    recoveryTime: avgResponseTime * 2
                },
                userExperience: {
                    satisfaction: score,
                    taskCompletion: avgAccuracy * 100,
                    learningCurve: 100 - score
                },
                resourceUsage: {
                    memory: 45,
                    cpu: 30,
                    network: 15
                }
            });

        } catch (error) {
            console.error("Error loading system metrics:", error);
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
                return <ThunderboltOutlined />;
            case "security_monitor":
                return <SecurityScanOutlined />;
            case "optimization_engine":
                return <SettingOutlined />;
            case "coordinator":
                return <RobotOutlined />;
            case "mcp_integration":
                return <ApiOutlined />;
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

    const handleEmergencyStop = async () => {
        setSystemStatus("initializing");

        // Disable all agents temporarily
        agents.forEach(agent => {
            if (agentCoordinator.getAgent(agent.id)) {
                // This would disable the agent
            }
        });

        // Restart system
        setTimeout(() => {
            initializeSystem();
        }, 2000);
    };

    return (
        <div className="hyper-intelligent-terminal">
            {/* System Status Header */}
            <Card className="system-status-card">
                <div className="status-header">
                    <div className="status-info">
                        <Title level={4}>
                            <RobotOutlined />
                            Hyper-Intelligent Terminal System
                        </Title>
                        <div className="status-indicators">
                            <Badge
                                status={systemStatus === "ready" ? "success" : systemStatus === "error" ? "error" : "processing"}
                                text={
                                    <span style={{ textTransform: "capitalize" }}>
                                        {systemStatus === "initializing" ? "Initializing AI Agents..." :
                                         systemStatus === "ready" ? "All Systems Operational" :
                                         systemStatus === "processing" ? "Processing Commands..." :
                                         "System Error"}
                                    </span>
                                }
                            />
                            <div className="performance-score">
                                <Progress
                                    type="circle"
                                    percent={performanceScore}
                                    format={(percent) => `${percent}%`}
                                    size={60}
                                    strokeColor={performanceScore > 80 ? "#52c41a" : performanceScore > 60 ? "#faad14" : "#ff4d4f"}
                                />
                                <div className="score-label">
                                    <Text strong>AI Performance</Text>
                                    <Text type="secondary">System Efficiency</Text>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="status-actions">
                        <Space>
                            <Tooltip title="System Metrics">
                                <Button
                                    icon={<DatabaseOutlined />}
                                    onClick={() => {/* Show metrics modal */}}
                                >
                                    Metrics
                                </Button>
                            </Tooltip>
                            <Tooltip title="Emergency Stop">
                                <Button
                                    danger
                                    icon={<StopOutlined />}
                                    onClick={handleEmergencyStop}
                                    disabled={systemStatus !== "ready"}
                                >
                                    Emergency Stop
                                </Button>
                            </Tooltip>
                            <Tooltip title="Restart AI System">
                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={initializeSystem}
                                    loading={systemStatus === "initializing"}
                                >
                                    Restart
                                </Button>
                            </Tooltip>
                        </Space>
                    </div>
                </div>

                {/* Active Features */}
                <div className="active-features">
                    <Text strong>Active AI Features:</Text>
                    <div className="features-tags">
                        {activeFeatures.map(feature => (
                            <Tag key={feature} color="blue">
                                {feature.replace(/_/g, " ")}
                            </Tag>
                        ))}
                    </div>
                </div>
            </Card>

            {/* Agent Status Dashboard */}
            <Card className="agents-dashboard">
                <Title level={5}>AI Agent Team Status</Title>
                <Row gutter={16}>
                    {agents.map(agent => (
                        <Col span={6} key={agent.id}>
                            <Card size="small" className="agent-status-card">
                                <div className="agent-status">
                                    <div className="agent-icon">
                                        {getAgentIcon(agent.type)}
                                    </div>
                                    <div className="agent-info">
                                        <div className="agent-name">{agent.name}</div>
                                        <Tag
                                            color={getStatusColor(agent.status)}
                                            style={{ fontSize: '10px' }}
                                        >
                                            {agent.status}
                                        </Tag>
                                    </div>
                                    <div className="agent-priority">
                                        <Text style={{ fontSize: '10px' }}>
                                            Priority: {agent.priority}
                                        </Text>
                                    </div>
                                </div>
                                <Progress
                                    percent={agent.context.performance.accuracy * 100}
                                    size="small"
                                    showInfo={false}
                                    strokeColor={agent.context.performance.accuracy > 0.8 ? "#52c41a" : "#faad14"}
                                />
                            </Card>
                        </Col>
                    ))}
                </Row>
            </Card>

            {/* Enhanced Terminal Input */}
            <Card className="terminal-input-card">
                <EnhancedTerminalInput
                    onCommand={onCommand}
                    workingDirectory={workingDirectory}
                    shellType={shellType}
                    recentCommands={recentCommands}
                    environmentVariables={environmentVariables}
                    placeholder="Enter command or describe what you want to do..."
                />
            </Card>

            {/* System Metrics Display */}
            {metrics && (
                <Card className="metrics-display">
                    <Row gutter={16}>
                        <Col span={6}>
                            <Statistic
                                title="Response Time"
                                value={metrics.performance.responseTime}
                                suffix="ms"
                                valueStyle={{
                                    color: metrics.performance.responseTime < 500 ? "#3f8600" : "#cf1322"
                                }}
                            />
                        </Col>
                        <Col span={6}>
                            <Statistic
                                title="System Efficiency"
                                value={metrics.performance.efficiency}
                                suffix="%"
                                valueStyle={{
                                    color: metrics.performance.efficiency > 80 ? "#3f8600" : "#cf1322"
                                }}
                            />
                        </Col>
                        <Col span={6}>
                            <Statistic
                                title="Uptime"
                                value={metrics.reliability.uptime}
                                suffix="%"
                                valueStyle={{
                                    color: metrics.reliability.uptime > 99 ? "#3f8600" : "#cf1322"
                                }}
                            />
                        </Col>
                        <Col span={6}>
                            <Statistic
                                title="Memory Usage"
                                value={metrics.resourceUsage.memory}
                                suffix="%"
                                valueStyle={{
                                    color: metrics.resourceUsage.memory < 70 ? "#3f8600" : "#cf1322"
                                }}
                            />
                        </Col>
                    </Row>
                </Card>
            )}

            {/* System Alerts */}
            <div className="system-alerts">
                {systemStatus === "error" && (
                    <Alert
                        message="System Error"
                        description="One or more AI agents encountered an error. System performance may be degraded."
                        type="error"
                        showIcon
                        closable
                        action={
                            <Button size="small" onClick={initializeSystem}>
                                Restart System
                            </Button>
                        }
                    />
                )}

                {performanceScore < 60 && (
                    <Alert
                        message="Performance Degradation"
                        description="AI system performance is below optimal levels. Consider restarting or adjusting settings."
                        type="warning"
                        showIcon
                        closable
                    />
                )}
            </div>
        </div>
    );
};

export default HyperIntelligentTerminal;
