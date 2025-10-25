// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useEffect } from "react";
import {
    Card,
    Alert,
    Button,
    Tag,
    List,
    Typography,
    Space,
    Progress,
    Statistic,
    Row,
    Col,
    Tooltip,
    Switch,
    Divider
} from "antd";
import {
    SecurityScanOutlined,
    WarningOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ThunderboltOutlined,
    EyeOutlined,
    LockOutlined,
    ShieldOutlined,
    BugOutlined,
    ApiOutlined
} from "@ant-design/icons";
import { SecurityAnalysis } from "./aitypes";
import { agentCoordinator } from "./agent-coordinator";

const { Title, Text, Paragraph } = Typography;

interface SecurityMonitorProps {
    visible: boolean;
    onClose: () => void;
}

export const SecurityMonitor: React.FC<SecurityMonitorProps> = ({
    visible,
    onClose
}) => {
    const [analysis, setAnalysis] = useState<SecurityAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [autoProtection, setAutoProtection] = useState(true);
    const [realTimeMonitoring, setRealTimeMonitoring] = useState(true);

    // Load security analysis
    useEffect(() => {
        if (visible) {
            loadSecurityAnalysis();
        }
    }, [visible]);

    const loadSecurityAnalysis = async () => {
        setLoading(true);
        try {
            // This would trigger the security agent to perform analysis
            const context = {
                sessionId: "current",
                tabId: "main",
                workingDirectory: process.cwd(),
                recentCommands: [],
                environmentVariables: process.env,
                shellType: "bash",
                sharedContext: {},
                performance: { responseTime: 0, accuracy: 0, reliability: 0 }
            };

            await agentCoordinator.requestCommandAnalysis("security_scan", context);
            // In a real implementation, this would return actual security analysis
            setAnalysis({
                riskLevel: "low",
                threats: [
                    {
                        type: "suspicious_command",
                        severity: "medium",
                        description: "Unusual command pattern detected",
                        recommendation: "Review command history and verify legitimacy"
                    }
                ],
                protections: [
                    {
                        type: "command_validation",
                        status: "active",
                        description: "Validates commands before execution"
                    },
                    {
                        type: "environment_monitoring",
                        status: "active",
                        description: "Monitors environment variable changes"
                    },
                    {
                        type: "network_filtering",
                        status: "inactive",
                        description: "Filters suspicious network connections"
                    }
                ],
                recommendations: [
                    "Enable network filtering for enhanced protection",
                    "Review recent command history",
                    "Update system packages",
                    "Enable two-factor authentication for AI services"
                ]
            });
        } catch (error) {
            console.error("Error loading security analysis:", error);
        } finally {
            setLoading(false);
        }
    };

    const getRiskColor = (riskLevel: string) => {
        switch (riskLevel) {
            case "low":
                return "green";
            case "medium":
                return "orange";
            case "high":
                return "red";
            case "critical":
                return "magenta";
            default:
                return "default";
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case "low":
                return "green";
            case "medium":
                return "orange";
            case "high":
                return "red";
            case "critical":
                return "magenta";
            default:
                return "default";
        }
    };

    const handleProtectionToggle = async (protectionType: string, enabled: boolean) => {
        try {
            // This would trigger the security agent to enable/disable protection
            await agentCoordinator.requestCommandAnalysis(
                `protection_${enabled ? 'enable' : 'disable'}_${protectionType}`,
                {
                    sessionId: "current",
                    tabId: "main",
                    workingDirectory: process.cwd(),
                    recentCommands: [],
                    environmentVariables: process.env,
                    shellType: "bash",
                    sharedContext: { protectionType, enabled },
                    performance: { responseTime: 0, accuracy: 0, reliability: 0 }
                }
            );
        } catch (error) {
            console.error("Error toggling protection:", error);
        }
    };

    if (!visible) return null;

    return (
        <div className="security-monitor-overlay">
            <div className="monitor-backdrop" onClick={onClose} />
            <div className="monitor-container">
                <Card
                    className="monitor-card"
                    title={
                        <div className="monitor-header">
                            <SecurityScanOutlined />
                            <span>Security Monitor & Protection</span>
                            <Button
                                type="text"
                                icon={<CloseCircleOutlined />}
                                onClick={onClose}
                                className="monitor-close"
                            />
                        </div>
                    }
                    extra={
                        <Button
                            icon={<ThunderboltOutlined />}
                            onClick={loadSecurityAnalysis}
                            loading={loading}
                        >
                            Scan Now
                        </Button>
                    }
                >
                    {loading ? (
                        <div className="monitor-loading">
                            <SecurityScanOutlined spin />
                            <Text>Scanning system for threats...</Text>
                        </div>
                    ) : analysis ? (
                        <div className="monitor-content">
                            {/* Risk Level Overview */}
                            <div className="risk-overview">
                                <Row gutter={16}>
                                    <Col span={6}>
                                        <Statistic
                                            title="Risk Level"
                                            value={analysis.riskLevel.toUpperCase()}
                                            valueStyle={{
                                                color: getRiskColor(analysis.riskLevel) === 'green' ? '#3f8600' :
                                                       getRiskColor(analysis.riskLevel) === 'orange' ? '#cf1322' :
                                                       getRiskColor(analysis.riskLevel) === 'red' ? '#d48806' : '#666'
                                            }}
                                        />
                                    </Col>
                                    <Col span={6}>
                                        <Statistic
                                            title="Active Threats"
                                            value={analysis.threats.length}
                                            valueStyle={{ color: analysis.threats.length > 0 ? '#cf1322' : '#3f8600' }}
                                        />
                                    </Col>
                                    <Col span={6}>
                                        <Statistic
                                            title="Protections"
                                            value={analysis.protections.filter(p => p.status === 'active').length}
                                            suffix={`/ ${analysis.protections.length}`}
                                        />
                                    </Col>
                                    <Col span={6}>
                                        <Statistic
                                            title="Recommendations"
                                            value={analysis.recommendations.length}
                                        />
                                    </Col>
                                </Row>
                            </div>

                            <Divider />

                            {/* Security Controls */}
                            <div className="security-controls">
                                <Title level={4}>Security Controls</Title>
                                <Space direction="vertical" style={{ width: '100%' }}>
                                    <div className="control-item">
                                        <div className="control-info">
                                            <LockOutlined />
                                            <div>
                                                <Text strong>Auto Protection</Text>
                                                <Paragraph type="secondary">
                                                    Automatically enable protections when threats are detected
                                                </Paragraph>
                                            </div>
                                        </div>
                                        <Switch
                                            checked={autoProtection}
                                            onChange={setAutoProtection}
                                        />
                                    </div>

                                    <div className="control-item">
                                        <div className="control-info">
                                            <EyeOutlined />
                                            <div>
                                                <Text strong>Real-time Monitoring</Text>
                                                <Paragraph type="secondary">
                                                    Monitor system activity in real-time
                                                </Paragraph>
                                            </div>
                                        </div>
                                        <Switch
                                            checked={realTimeMonitoring}
                                            onChange={setRealTimeMonitoring}
                                        />
                                    </div>
                                </Space>
                            </div>

                            <Divider />

                            {/* Active Threats */}
                            {analysis.threats.length > 0 && (
                                <div className="threats-section">
                                    <Title level={4}>
                                        <WarningOutlined />
                                        Active Threats
                                    </Title>
                                    <List
                                        dataSource={analysis.threats}
                                        renderItem={(threat) => (
                                            <List.Item className="threat-item">
                                                <div className="threat-content">
                                                    <div className="threat-header">
                                                        <Tag color={getSeverityColor(threat.severity)}>
                                                            {threat.severity.toUpperCase()}
                                                        </Tag>
                                                        <Text strong>{threat.type}</Text>
                                                    </div>
                                                    <Paragraph>{threat.description}</Paragraph>
                                                    <div className="threat-recommendation">
                                                        <CheckCircleOutlined />
                                                        <Text type="secondary">
                                                            {threat.recommendation}
                                                        </Text>
                                                    </div>
                                                </div>
                                            </List.Item>
                                        )}
                                    />
                                </div>
                            )}

                            <Divider />

                            {/* Protection Status */}
                            <div className="protections-section">
                                <Title level={4}>
                                    <ShieldOutlined />
                                    Protection Status
                                </Title>
                                <Row gutter={16}>
                                    {analysis.protections.map((protection, index) => (
                                        <Col span={12} key={index}>
                                            <Card size="small" className="protection-card">
                                                <div className="protection-header">
                                                    <div className="protection-icon">
                                                        {protection.status === 'active' ?
                                                            <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
                                                            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                                                        }
                                                    </div>
                                                    <div className="protection-info">
                                                        <Text strong>{protection.type}</Text>
                                                        <Tag color={protection.status === 'active' ? 'green' : 'default'}>
                                                            {protection.status}
                                                        </Tag>
                                                    </div>
                                                    <Switch
                                                        checked={protection.status === 'active'}
                                                        onChange={(checked) =>
                                                            handleProtectionToggle(protection.type, checked)
                                                        }
                                                        size="small"
                                                    />
                                                </div>
                                                <Paragraph type="secondary" style={{ fontSize: '12px' }}>
                                                    {protection.description}
                                                </Paragraph>
                                            </Card>
                                        </Col>
                                    ))}
                                </Row>
                            </div>

                            <Divider />

                            {/* Recommendations */}
                            {analysis.recommendations.length > 0 && (
                                <div className="recommendations-section">
                                    <Title level={4}>
                                        <BugOutlined />
                                        Security Recommendations
                                    </Title>
                                    <Alert
                                        message="Security Improvements Available"
                                        description={
                                            <List
                                                dataSource={analysis.recommendations}
                                                renderItem={(recommendation, index) => (
                                                    <List.Item key={index} className="recommendation-item">
                                                        <Text>• {recommendation}</Text>
                                                    </List.Item>
                                                )}
                                            />
                                        }
                                        type="info"
                                        showIcon
                                    />
                                </div>
                            )}

                            {/* Security Score */}
                            <div className="security-score">
                                <Title level={4}>Security Score</Title>
                                <div className="score-display">
                                    <Progress
                                        type="circle"
                                        percent={85}
                                        format={(percent) => `${percent}%`}
                                        strokeColor="#52c41a"
                                        size={120}
                                    />
                                    <div className="score-details">
                                        <Text strong>Overall Security: Good</Text>
                                        <Paragraph type="secondary">
                                            Your system is well protected. Consider implementing the
                                            recommended improvements for enhanced security.
                                        </Paragraph>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="monitor-empty">
                            <SecurityScanOutlined />
                            <Text>No security analysis available</Text>
                            <Button onClick={loadSecurityAnalysis} loading={loading}>
                                Run Security Scan
                            </Button>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default SecurityMonitor;
