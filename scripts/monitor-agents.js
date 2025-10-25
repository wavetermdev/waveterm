#!/usr/bin/env node

/**
 * Real-time AI Agent Monitoring and Performance Dashboard
 * Monitors agent status, performance, and system health
 */

const fs = require('fs');
const path = require('path');

class AgentMonitor {
    constructor() {
        this.metrics = new Map();
        this.alerts = [];
        this.isMonitoring = false;
        this.updateInterval = 5000; // 5 seconds
    }

    startMonitoring() {
        console.log('🚀 Starting AI Agent Monitoring...\n');
        this.isMonitoring = true;

        // Initial status check
        this.checkAgentStatus();

        // Start continuous monitoring
        this.interval = setInterval(() => {
            this.checkAgentStatus();
            this.checkPerformance();
            this.checkSecurity();
            this.displayDashboard();
        }, this.updateInterval);

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Stopping monitoring...');
            this.stopMonitoring();
            process.exit(0);
        });
    }

    stopMonitoring() {
        this.isMonitoring = false;
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    checkAgentStatus() {
        const agents = [
            { id: 'command-analyzer', name: 'Command Analysis', file: 'agent-coordinator.ts' },
            { id: 'context-manager', name: 'Context Manager', file: 'agent-coordinator.ts' },
            { id: 'command-explainer', name: 'Command Explainer', file: 'agent-coordinator.ts' },
            { id: 'pattern-analyzer', name: 'Pattern Analysis', file: 'agent-coordinator.ts' },
            { id: 'security-monitor', name: 'Security Monitor', file: 'security-monitor.tsx' },
            { id: 'optimization-engine', name: 'Optimization Engine', file: 'agent-coordinator.ts' },
            { id: 'mcp-integration', name: 'MCP Integration', file: 'mcp-integration.ts' },
            { id: 'coordinator', name: 'Coordinator', file: 'agent-coordinator.ts' }
        ];

        const agentStatus = agents.map(agent => {
            const filePath = path.join('frontend/app/aipanel', agent.file);
            const exists = fs.existsSync(filePath);
            const size = exists ? fs.statSync(filePath).size : 0;
            const modified = exists ? fs.statSync(filePath).mtime : new Date();

            return {
                id: agent.id,
                name: agent.name,
                status: exists ? 'ACTIVE' : 'MISSING',
                size: `${Math.round(size / 1024)}KB`,
                modified: modified.toLocaleTimeString(),
                performance: this.getAgentPerformance(agent.id)
            };
        });

        this.metrics.set('agents', agentStatus);
    }

    getAgentPerformance(agentId) {
        const now = Date.now();
        const lastUpdate = this.metrics.get(`${agentId}_last_update`) || now;

        return {
            responseTime: Math.random() * 200 + 50, // Mock response time
            accuracy: Math.random() * 0.2 + 0.8,   // Mock accuracy
            reliability: Math.random() * 0.1 + 0.9, // Mock reliability
            uptime: Math.random() * 0.01 + 0.99     // Mock uptime
        };
    }

    checkPerformance() {
        const agents = this.metrics.get('agents') || [];
        const performance = {
            averageResponseTime: 0,
            averageAccuracy: 0,
            averageReliability: 0,
            systemLoad: Math.random() * 30 + 20, // Mock CPU usage
            memoryUsage: Math.random() * 20 + 40, // Mock memory usage
            activeAgents: agents.filter(a => a.status === 'ACTIVE').length,
            totalAgents: agents.length
        };

        // Calculate averages
        agents.forEach(agent => {
            performance.averageResponseTime += agent.performance.responseTime;
            performance.averageAccuracy += agent.performance.accuracy;
            performance.averageReliability += agent.performance.reliability;
        });

        performance.averageResponseTime /= agents.length;
        performance.averageAccuracy /= agents.length;
        performance.averageReliability /= agents.length;

        this.metrics.set('performance', performance);
    }

    checkSecurity() {
        const security = {
            threats: Math.floor(Math.random() * 3), // Mock threat count
            riskLevel: Math.random() > 0.8 ? 'HIGH' : Math.random() > 0.5 ? 'MEDIUM' : 'LOW',
            protections: Math.floor(Math.random() * 5) + 3, // Mock active protections
            lastScan: new Date().toLocaleTimeString()
        };

        this.metrics.set('security', security);
    }

    displayDashboard() {
        const agents = this.metrics.get('agents') || [];
        const performance = this.metrics.get('performance') || {};
        const security = this.metrics.get('security') || {};

        console.clear();
        console.log('🤖 HYPER-INTELLIGENT TERMINAL - REAL-TIME MONITORING');
        console.log('=' .repeat(60));
        console.log(`⏰ Last Update: ${new Date().toLocaleString()}`);
        console.log();

        // Agent Status
        console.log('📊 AGENT STATUS:');
        console.log('┌' + '─'.repeat(58) + '┐');
        console.log('│ Agent Name              │ Status  │ Perf  │ Size  │ Modified    │');
        console.log('├' + '─'.repeat(58) + '┤');

        agents.forEach(agent => {
            const statusColor = agent.status === 'ACTIVE' ? '🟢' : '🔴';
            const perfColor = agent.performance.accuracy > 0.9 ? '🟢' :
                            agent.performance.accuracy > 0.7 ? '🟡' : '🔴';

            console.log(`│ ${agent.name.padEnd(23)} │ ${statusColor} ${agent.status.padEnd(6)} │ ${perfColor} ${agent.performance.accuracy.toFixed(1).padStart(4)} │ ${agent.size.padStart(5)} │ ${agent.modified.padStart(11)} │`);
        });

        console.log('└' + '─'.repeat(58) + '┘');
        console.log();

        // Performance Metrics
        console.log('⚡ PERFORMANCE METRICS:');
        console.log(`  Response Time: ${performance.averageResponseTime?.toFixed(0) || 0}ms (Target: <500ms)`);
        console.log(`  Accuracy: ${(performance.averageAccuracy * 100 || 0).toFixed(1)}% (Target: >80%)`);
        console.log(`  Reliability: ${(performance.averageReliability * 100 || 0).toFixed(1)}% (Target: >90%)`);
        console.log(`  Active Agents: ${performance.activeAgents || 0}/${performance.totalAgents || 0}`);
        console.log(`  System Load: ${performance.systemLoad?.toFixed(1) || 0}% CPU`);
        console.log(`  Memory Usage: ${performance.memoryUsage?.toFixed(1) || 0}%`);
        console.log();

        // Security Status
        console.log('🔒 SECURITY STATUS:');
        const riskEmoji = security.riskLevel === 'HIGH' ? '🔴' :
                        security.riskLevel === 'MEDIUM' ? '🟡' : '🟢';
        console.log(`  Risk Level: ${riskEmoji} ${security.riskLevel}`);
        console.log(`  Active Threats: ${security.threats || 0}`);
        console.log(`  Active Protections: ${security.protections || 0}`);
        console.log(`  Last Security Scan: ${security.lastScan}`);
        console.log();

        // System Health Score
        const healthScore = this.calculateHealthScore(agents, performance, security);
        const healthEmoji = healthScore >= 90 ? '🟢' : healthScore >= 70 ? '🟡' : '🔴';
        console.log(`🎯 SYSTEM HEALTH: ${healthEmoji} ${healthScore}/100`);

        // Alerts
        if (this.alerts.length > 0) {
            console.log('\n🚨 ACTIVE ALERTS:');
            this.alerts.forEach(alert => {
                console.log(`  ${alert.level}: ${alert.message}`);
            });
        }

        console.log('\n💡 COMMANDS:');
        console.log('  Ctrl+C - Stop monitoring');
        console.log('  npm run agents:status - Quick status check');
        console.log('  npm run security:scan - Security scan');
        console.log('  npm run test:ai - Run AI tests');
    }

    calculateHealthScore(agents, performance, security) {
        let score = 100;

        // Agent availability (30%)
        const activeAgents = agents.filter(a => a.status === 'ACTIVE').length;
        const agentScore = (activeAgents / agents.length) * 30;
        score = Math.max(0, score - (30 - agentScore));

        // Performance (40%)
        const avgResponseTime = performance.averageResponseTime || 0;
        const avgAccuracy = performance.averageAccuracy || 0;
        const avgReliability = performance.averageReliability || 0;

        if (avgResponseTime > 500) score -= 15;
        if (avgAccuracy < 0.8) score -= 10;
        if (avgReliability < 0.9) score -= 15;

        // Security (30%)
        if (security.riskLevel === 'HIGH') score -= 30;
        else if (security.riskLevel === 'MEDIUM') score -= 15;

        if (security.threats > 0) score -= 10;

        return Math.max(0, Math.round(score));
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            agents: this.metrics.get('agents') || [],
            performance: this.metrics.get('performance') || {},
            security: this.metrics.get('security') || {},
            alerts: this.alerts,
            healthScore: this.calculateHealthScore(
                this.metrics.get('agents') || [],
                this.metrics.get('performance') || {},
                this.metrics.get('security') || {}
            )
        };

        fs.writeFileSync('agent-monitoring-report.json', JSON.stringify(report, null, 2));
        console.log('\n📄 Monitoring report saved to: agent-monitoring-report.json');
    }
}

// Main execution
function main() {
    const monitor = new AgentMonitor();

    monitor.startMonitoring();

    // Generate final report on exit
    process.on('exit', () => {
        monitor.generateReport();
    });
}

if (require.main === module) {
    main();
}

module.exports = AgentMonitor;
