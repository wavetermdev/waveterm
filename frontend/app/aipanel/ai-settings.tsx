// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect } from "react";
import {
    Modal,
    Form,
    Switch,
    Select,
    Input,
    Slider,
    Tabs,
    Card,
    Button,
    Divider,
    Typography,
    Space,
    InputNumber,
    Tooltip,
    Alert,
    Tag
} from "antd";
import {
    RobotOutlined,
    SettingOutlined,
    ApiOutlined,
    SecurityScanOutlined,
    ThunderboltOutlined,
    DatabaseOutlined,
    CodeOutlined,
    InfoCircleOutlined,
    SaveOutlined,
    ReloadOutlined
} from "@ant-design/icons";
import { AIAgent, AgentType } from "./aitypes";
import { agentCoordinator } from "./agent-coordinator";

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { Option } = Select;

interface AISettingsProps {
    visible: boolean;
    onClose: () => void;
    agents: AIAgent[];
}

export const AISettings: React.FC<AISettingsProps> = ({
    visible,
    onClose,
    agents
}) => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("general");

    // Agent type configurations
    const agentConfigs = {
        command_analysis: {
            name: "Command Analysis",
            icon: <CodeOutlined />,
            description: "Analyzes commands and provides suggestions",
            settings: {
                confidenceThreshold: { min: 0, max: 1, step: 0.1, default: 0.7 },
                maxSuggestions: { min: 1, max: 10, default: 5 },
                enableCorrections: { default: true },
                enableOptimizations: { default: true }
            }
        },
        context_manager: {
            name: "Context Manager",
            icon: <DatabaseOutlined />,
            description: "Manages terminal context and session data",
            settings: {
                maxContextSize: { min: 100, max: 5000, default: 1000 },
                enablePersistence: { default: true },
                contextWindow: { min: 10, max: 100, default: 50 }
            }
        },
        command_explanation: {
            name: "Command Explainer",
            icon: <InfoCircleOutlined />,
            description: "Provides detailed explanations for commands",
            settings: {
                explanationDepth: { options: ["brief", "detailed", "comprehensive"], default: "detailed" },
                includeExamples: { default: true },
                maxExamples: { min: 1, max: 5, default: 3 }
            }
        },
        pattern_analysis: {
            name: "Pattern Analysis",
            icon: <ThunderboltOutlined />,
            description: "Detects patterns and suggests optimizations",
            settings: {
                minPatternFrequency: { min: 1, max: 10, default: 2 },
                enableAutomation: { default: true },
                optimizationLevel: { options: ["conservative", "balanced", "aggressive"], default: "balanced" }
            }
        },
        security_monitor: {
            name: "Security Monitor",
            icon: <SecurityScanOutlined />,
            description: "Monitors for security threats and risks",
            settings: {
                riskThreshold: { options: ["low", "medium", "high", "critical"], default: "medium" },
                enableRealTimeMonitoring: { default: true },
                autoProtection: { default: true }
            }
        },
        optimization_engine: {
            name: "Optimization Engine",
            icon: <ThunderboltOutlined />,
            description: "Optimizes performance and resource usage",
            settings: {
                optimizationInterval: { min: 1000, max: 60000, step: 1000, default: 30000 },
                enableAutoOptimization: { default: true },
                targetEfficiency: { min: 0.5, max: 1.0, step: 0.1, default: 0.9 }
            }
        },
        mcp_integration: {
            name: "MCP Integration",
            icon: <ApiOutlined />,
            description: "Manages MCP protocol connections",
            settings: {
                mcpPort: { min: 1024, max: 65535, default: 3000 },
                enableToolDiscovery: { default: true },
                maxConnections: { min: 1, max: 50, default: 10 }
            }
        }
    };

    // Load current settings
    useEffect(() => {
        if (visible && agents.length > 0) {
            const settings: Record<string, any> = {};

            agents.forEach(agent => {
                settings[agent.id] = agent.settings;
                // Also set general settings
                settings[`${agent.id}_enabled`] = agent.status === "active";
                settings[`${agent.id}_priority`] = agent.priority;
            });

            form.setFieldsValue(settings);
        }
    }, [visible, agents, form]);

    const handleSave = async () => {
        setLoading(true);
        try {
            const values = await form.validateFields();

            // Update each agent with new settings
            agents.forEach(agent => {
                const isEnabled = values[`${agent.id}_enabled`];
                const priority = values[`${agent.id}_priority`];
                const agentSettings = values[agent.id] || {};

                // Update agent status and settings
                if (agentCoordinator.getAgent(agent.id)) {
                    agentCoordinator.updateAgentContext(agent.id, {
                        ...agent.context,
                        performance: {
                            ...agent.context.performance,
                            accuracy: agentSettings.confidenceThreshold || agent.context.performance.accuracy
                        }
                    });
                }
            });

            // Save to localStorage
            localStorage.setItem("waveai_settings", JSON.stringify(values));

            // Show success message
            setTimeout(() => {
                setLoading(false);
                onClose();
            }, 1000);

        } catch (error) {
            console.error("Error saving settings:", error);
            setLoading(false);
        }
    };

    const handleReset = () => {
        form.resetFields();
        localStorage.removeItem("waveai_settings");
    };

    const renderAgentSettings = (agent: AIAgent) => {
        const config = agentConfigs[agent.type as keyof typeof agentConfigs];
        if (!config) return null;

        return (
            <Card key={agent.id} className="agent-settings-card">
                <div className="agent-header">
                    <div className="agent-icon-title">
                        {config.icon}
                        <div className="agent-info">
                            <Title level={5}>{config.name}</Title>
                            <Text type="secondary">{config.description}</Text>
                        </div>
                    </div>
                    <div className="agent-status">
                        <Tag color={agent.status === "active" ? "green" : "default"}>
                            {agent.status}
                        </Tag>
                        <Form.Item name={`${agent.id}_enabled`} valuePropName="checked" noStyle>
                            <Switch />
                        </Form.Item>
                    </div>
                </div>

                <Divider />

                <div className="agent-controls">
                    <Form.Item label="Priority" name={`${agent.id}_priority`}>
                        <InputNumber min={0} max={10} />
                    </Form.Item>

                    {Object.entries(config.settings).map(([key, setting]) => (
                        <Form.Item key={key} label={key.replace(/([A-Z])/g, " $1").toLowerCase()}>
                            {typeof setting.default === "boolean" ? (
                                <Form.Item name={`${agent.id}_${key}`} valuePropName="checked" noStyle>
                                    <Switch />
                                </Form.Item>
                            ) : typeof setting.default === "string" && setting.options ? (
                                <Form.Item name={`${agent.id}_${key}`} noStyle>
                                    <Select placeholder={`Select ${key}`}>
                                        {setting.options.map((option: string) => (
                                            <Option key={option} value={option}>
                                                {option.charAt(0).toUpperCase() + option.slice(1)}
                                            </Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                            ) : typeof setting.default === "number" && setting.min !== undefined ? (
                                <Form.Item name={`${agent.id}_${key}`} noStyle>
                                    <Slider
                                        min={setting.min}
                                        max={setting.max}
                                        step={setting.step || 1}
                                    />
                                </Form.Item>
                            ) : (
                                <Form.Item name={`${agent.id}_${key}`} noStyle>
                                    <Input />
                                </Form.Item>
                            )}
                        </Form.Item>
                    ))}
                </div>
            </Card>
        );
    };

    return (
        <Modal
            title={
                <div className="settings-modal-header">
                    <RobotOutlined />
                    <span>AI Agent Settings</span>
                </div>
            }
            open={visible}
            onCancel={onClose}
            footer={[
                <Button key="reset" onClick={handleReset}>
                    <ReloadOutlined />
                    Reset
                </Button>,
                <Button key="cancel" onClick={onClose}>
                    Cancel
                </Button>,
                <Button key="save" type="primary" loading={loading} onClick={handleSave}>
                    <SaveOutlined />
                    Save Settings
                </Button>
            ]}
            width={800}
            className="ai-settings-modal"
        >
            <Alert
                message="AI Agent Configuration"
                description="Configure your AI agents for optimal performance. Changes take effect immediately and are saved automatically."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
            />

            <Tabs activeKey={activeTab} onChange={setActiveTab} className="settings-tabs">
                <TabPane tab="General" key="general">
                    <Card title="Global AI Settings">
                        <Form form={form} layout="vertical">
                            <Form.Item label="Enable AI Features" name="ai_enabled" valuePropName="checked">
                                <Switch />
                            </Form.Item>

                            <Form.Item label="AI Provider" name="ai_provider">
                                <Select placeholder="Select AI provider">
                                    <Option value="openai">OpenAI</Option>
                                    <Option value="anthropic">Anthropic (Claude)</Option>
                                    <Option value="google">Google (Gemini)</Option>
                                    <Option value="perplexity">Perplexity</Option>
                                    <Option value="ollama">Ollama (Local)</Option>
                                </Select>
                            </Form.Item>

                            <Form.Item label="API Key" name="api_key">
                                <Input.Password placeholder="Enter your API key" />
                            </Form.Item>

                            <Form.Item label="Model" name="model">
                                <Select placeholder="Select model">
                                    <Option value="gpt-4">GPT-4</Option>
                                    <Option value="gpt-3.5-turbo">GPT-3.5 Turbo</Option>
                                    <Option value="claude-3-opus">Claude 3 Opus</Option>
                                    <Option value="claude-3-sonnet">Claude 3 Sonnet</Option>
                                    <Option value="gemini-pro">Gemini Pro</Option>
                                </Select>
                            </Form.Item>

                            <Form.Item label="Max Tokens" name="max_tokens">
                                <InputNumber min={100} max={10000} />
                            </Form.Item>

                            <Form.Item label="Temperature" name="temperature">
                                <Slider min={0} max={2} step={0.1} />
                            </Form.Item>
                        </Form>
                    </Card>
                </TabPane>

                <TabPane tab="Agents" key="agents">
                    <div className="agents-settings">
                        {agents.map(renderAgentSettings)}
                    </div>
                </TabPane>

                <TabPane tab="Security" key="security">
                    <Card title="Security & Privacy">
                        <Form form={form} layout="vertical">
                            <Form.Item label="Enable Security Monitoring" name="security_enabled" valuePropName="checked">
                                <Switch />
                            </Form.Item>

                            <Form.Item label="Risk Threshold" name="risk_threshold">
                                <Select>
                                    <Option value="low">Low</Option>
                                    <Option value="medium">Medium</Option>
                                    <Option value="high">High</Option>
                                    <Option value="critical">Critical</Option>
                                </Select>
                            </Form.Item>

                            <Form.Item label="Auto Protection" name="auto_protection" valuePropName="checked">
                                <Switch />
                            </Form.Item>

                            <Form.Item label="Data Retention (days)" name="data_retention">
                                <InputNumber min={1} max={365} />
                            </Form.Item>
                        </Form>
                    </Card>
                </TabPane>

                <TabPane tab="Performance" key="performance">
                    <Card title="Performance Optimization">
                        <Form form={form} layout="vertical">
                            <Form.Item label="Enable Auto Optimization" name="auto_optimization" valuePropName="checked">
                                <Switch />
                            </Form.Item>

                            <Form.Item label="Optimization Interval (ms)" name="optimization_interval">
                                <InputNumber min={1000} max={60000} step={1000} />
                            </Form.Item>

                            <Form.Item label="Target Efficiency" name="target_efficiency">
                                <Slider min={0.5} max={1.0} step={0.1} />
                            </Form.Item>

                            <Form.Item label="Max Memory Usage (%)" name="max_memory">
                                <InputNumber min={10} max={90} />
                            </Form.Item>
                        </Form>
                    </Card>
                </TabPane>
            </Tabs>
        </Modal>
    );
};

export default AISettings;
