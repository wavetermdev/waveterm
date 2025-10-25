#!/usr/bin/env node

/**
 * Security Audit and Best Practices Validation for Hyper-Intelligent Terminal
 * Performs comprehensive security analysis and implements best practices
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SecurityAuditor {
    constructor() {
        this.issues = [];
        this.recommendations = [];
        this.projectRoot = process.cwd();
    }

    async runAudit() {
        console.log('🔍 Starting Security Audit...\n');

        await this.auditFilePermissions();
        await this.auditDependencies();
        await this.auditCodeSecurity();
        await this.auditConfiguration();
        await this.auditNetworkSecurity();
        await this.auditDataHandling();
        await this.auditAIComponents();

        this.generateReport();
    }

    async auditFilePermissions() {
        console.log('📁 Auditing file permissions...');

        const sensitiveFiles = [
            '.env',
            'package.json',
            'tsconfig.json',
            'scripts/',
            'mcp-servers/'
        ];

        for (const file of sensitiveFiles) {
            const filePath = path.join(this.projectRoot, file);

            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                const permissions = (stats.mode & parseInt('777', 8)).toString(8);

                if (file.includes('.env') && permissions !== '600') {
                    this.issues.push({
                        type: 'CRITICAL',
                        category: 'File Permissions',
                        issue: `${file} should have 600 permissions`,
                        fix: 'chmod 600 .env'
                    });
                }

                if (file.includes('scripts') && permissions !== '755') {
                    this.issues.push({
                        type: 'WARNING',
                        category: 'File Permissions',
                        issue: `${file} should have 755 permissions`,
                        fix: 'chmod 755 scripts/*'
                    });
                }
            }
        }
    }

    async auditDependencies() {
        console.log('📦 Auditing dependencies...');

        const packageJson = require(path.join(this.projectRoot, 'package.json'));

        // Check for vulnerable dependencies
        const vulnerableDeps = [
            'electron', 'react', 'typescript', 'vite', 'ws'
        ];

        for (const dep of Object.keys(packageJson.dependencies)) {
            if (vulnerableDeps.includes(dep)) {
                this.recommendations.push({
                    category: 'Dependency Management',
                    recommendation: `Monitor ${dep} for security updates`,
                    action: 'npm audit fix'
                });
            }
        }

        // Check for development dependencies in production
        if (packageJson.devDependencies) {
            const devOnlyDeps = Object.keys(packageJson.devDependencies);
            if (devOnlyDeps.length > 0) {
                this.recommendations.push({
                    category: 'Build Process',
                    recommendation: 'Ensure devDependencies are not included in production build',
                    action: 'Review electron-builder config'
                });
            }
        }
    }

    async auditCodeSecurity() {
        console.log('💻 Auditing code security...');

        const aiComponents = [
            'frontend/app/aipanel/agent-coordinator.ts',
            'frontend/app/aipanel/mcp-integration.ts',
            'frontend/app/aipanel/security-monitor.tsx',
            'frontend/app/aipanel/enhanced-terminal-input.tsx'
        ];

        for (const component of aiComponents) {
            const filePath = path.join(this.projectRoot, component);

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');

                // Check for hardcoded secrets
                if (content.includes('API_KEY') || content.includes('password') || content.includes('secret')) {
                    this.issues.push({
                        type: 'CRITICAL',
                        category: 'Code Security',
                        issue: `Potential hardcoded secrets in ${component}`,
                        fix: 'Move secrets to environment variables'
                    });
                }

                // Check for unsafe eval usage
                if (content.includes('eval(') || content.includes('Function(')) {
                    this.issues.push({
                        type: 'HIGH',
                        category: 'Code Security',
                        issue: `Unsafe code execution in ${component}`,
                        fix: 'Replace eval() with safe alternatives'
                    });
                }

                // Check for proper input validation
                if (component.includes('input') && !content.includes('sanitize') && !content.includes('validate')) {
                    this.recommendations.push({
                        category: 'Input Validation',
                        recommendation: `Add input validation to ${component}`,
                        action: 'Implement proper sanitization'
                    });
                }
            }
        }
    }

    async auditConfiguration() {
        console.log('⚙️ Auditing configuration...');

        // Check .env file
        const envPath = path.join(this.projectRoot, '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');

            if (envContent.includes('your_openai_key_here') || envContent.includes('your_api_key')) {
                this.issues.push({
                    type: 'CRITICAL',
                    category: 'Configuration',
                    issue: 'Default/placeholder API keys found in .env',
                    fix: 'Replace with actual API keys or remove file'
                });
            }

            if (envContent.includes('localhost') && envContent.includes('3000')) {
                this.recommendations.push({
                    category: 'Network Security',
                    recommendation: 'Consider using HTTPS for production MCP connections',
                    action: 'Update MCP server configuration'
                });
            }
        }

        // Check TypeScript configuration
        const tsConfigPath = path.join(this.projectRoot, 'tsconfig.json');
        if (fs.existsSync(tsConfigPath)) {
            const tsConfig = require(tsConfigPath);

            if (!tsConfig.compilerOptions?.strict) {
                this.recommendations.push({
                    category: 'Type Safety',
                    recommendation: 'Enable strict TypeScript mode',
                    action: 'Set strict: true in tsconfig.json'
                });
            }
        }
    }

    async auditNetworkSecurity() {
        console.log('🌐 Auditing network security...');

        // Check for open ports and services
        const mcpServers = fs.readdirSync('mcp-servers').filter(f => f.endsWith('.py') || f.endsWith('.js'));

        for (const server of mcpServers) {
            const content = fs.readFileSync(path.join('mcp-servers', server), 'utf8');

            if (content.includes('localhost') || content.includes('127.0.0.1')) {
                this.recommendations.push({
                    category: 'Network Security',
                    recommendation: `MCP server ${server} uses localhost binding`,
                    action: 'Consider binding to specific interface in production'
                });
            }

            if (content.includes('port') && content.includes('3000')) {
                this.recommendations.push({
                    category: 'Port Security',
                    recommendation: 'Use non-standard ports for MCP services',
                    action: 'Change default MCP port to > 1024'
                });
            }
        }
    }

    async auditDataHandling() {
        console.log('💾 Auditing data handling...');

        // Check for sensitive data logging
        const aiFiles = [
            'frontend/app/aipanel/agent-coordinator.ts',
            'frontend/app/aipanel/mcp-integration.ts'
        ];

        for (const file of aiFiles) {
            const content = fs.readFileSync(file, 'utf8');

            if (content.includes('console.log') && (content.includes('API') || content.includes('key') || content.includes('token'))) {
                this.issues.push({
                    type: 'MEDIUM',
                    category: 'Data Logging',
                    issue: `Potential sensitive data logging in ${file}`,
                    fix: 'Remove or sanitize console.log statements'
                });
            }

            // Check for proper error handling
            if (!content.includes('try') || !content.includes('catch')) {
                this.recommendations.push({
                    category: 'Error Handling',
                    recommendation: `Add proper error handling to ${file}`,
                    action: 'Implement try-catch blocks'
                });
            }
        }
    }

    async auditAIComponents() {
        console.log('🤖 Auditing AI components...');

        // Check AI agent security
        const agentCoordinator = fs.readFileSync('frontend/app/aipanel/agent-coordinator.ts', 'utf8');

        if (!agentCoordinator.includes('sanitize') && !agentCoordinator.includes('validate')) {
            this.recommendations.push({
                category: 'AI Security',
                recommendation: 'Add input validation for AI agent requests',
                action: 'Implement request sanitization'
            });
        }

        // Check rate limiting
        if (!agentCoordinator.includes('rate') && !agentCoordinator.includes('limit')) {
            this.recommendations.push({
                category: 'Rate Limiting',
                recommendation: 'Implement rate limiting for AI requests',
                action: 'Add rate limiting middleware'
            });
        }

        // Check context isolation
        if (!agentCoordinator.includes('isolation') && !agentCoordinator.includes('sandbox')) {
            this.recommendations.push({
                category: 'Context Security',
                recommendation: 'Ensure proper context isolation between agents',
                action: 'Implement agent context sandboxing'
            });
        }
    }

    generateReport() {
        console.log('\n📋 SECURITY AUDIT REPORT');
        console.log('=' .repeat(50));

        // Critical Issues
        const criticalIssues = this.issues.filter(i => i.type === 'CRITICAL');
        if (criticalIssues.length > 0) {
            console.log('\n❌ CRITICAL ISSUES (Must Fix):');
            criticalIssues.forEach((issue, i) => {
                console.log(`  ${i + 1}. ${issue.category}: ${issue.issue}`);
                console.log(`     Fix: ${issue.fix}`);
            });
        }

        // High Priority Issues
        const highIssues = this.issues.filter(i => i.type === 'HIGH');
        if (highIssues.length > 0) {
            console.log('\n⚠️ HIGH PRIORITY ISSUES:');
            highIssues.forEach((issue, i) => {
                console.log(`  ${i + 1}. ${issue.category}: ${issue.issue}`);
                console.log(`     Fix: ${issue.fix}`);
            });
        }

        // Medium Priority Issues
        const mediumIssues = this.issues.filter(i => i.type === 'MEDIUM');
        if (mediumIssues.length > 0) {
            console.log('\n📝 MEDIUM PRIORITY ISSUES:');
            mediumIssues.forEach((issue, i) => {
                console.log(`  ${i + 1}. ${issue.category}: ${issue.issue}`);
                console.log(`     Fix: ${issue.fix}`);
            });
        }

        // Recommendations
        if (this.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            this.recommendations.forEach((rec, i) => {
                console.log(`  ${i + 1}. ${rec.category}: ${rec.recommendation}`);
                console.log(`     Action: ${rec.action}`);
            });
        }

        // Summary
        console.log('\n📊 SUMMARY:');
        console.log(`  Critical Issues: ${criticalIssues.length}`);
        console.log(`  High Priority: ${highIssues.length}`);
        console.log(`  Medium Priority: ${mediumIssues.length}`);
        console.log(`  Recommendations: ${this.recommendations.length}`);

        const totalIssues = criticalIssues.length + highIssues.length + mediumIssues.length;
        const score = Math.max(0, 100 - (totalIssues * 10) - (this.recommendations.length * 2));

        console.log(`\n🎯 SECURITY SCORE: ${score}/100`);

        if (score >= 90) {
            console.log('   🟢 EXCELLENT - Security posture is strong');
        } else if (score >= 70) {
            console.log('   🟡 GOOD - Some improvements needed');
        } else if (score >= 50) {
            console.log('   🟠 FAIR - Significant security improvements needed');
        } else {
            console.log('   🔴 POOR - Critical security issues must be addressed');
        }

        // Save report
        const report = {
            timestamp: new Date().toISOString(),
            score,
            issues: this.issues,
            recommendations: this.recommendations,
            summary: {
                critical: criticalIssues.length,
                high: highIssues.length,
                medium: mediumIssues.length,
                totalRecommendations: this.recommendations.length
            }
        };

        fs.writeFileSync('security-audit-report.json', JSON.stringify(report, null, 2));
        console.log('\n📄 Detailed report saved to: security-audit-report.json');

        if (criticalIssues.length > 0) {
            console.log('\n⚠️ WARNING: Critical security issues found. Please address them immediately.');
            process.exit(1);
        } else {
            console.log('\n✅ Audit complete. No critical issues found.');
        }
    }
}

// Best Practices Implementation
class BestPractices {
    constructor() {
        this.projectRoot = process.cwd();
    }

    async implementBestPractices() {
        console.log('\n🛠️ Implementing Best Practices...');

        await this.createSecurityConfig();
        await this.setupRateLimiting();
        await this.implementInputValidation();
        await this.setupMonitoring();
        await this.createDocumentation();
        await this.setupCI();

        console.log('✅ Best practices implementation complete');
    }

    async createSecurityConfig() {
        console.log('Creating security configuration...');

        const securityConfig = {
            rateLimiting: {
                maxRequestsPerMinute: 100,
                maxRequestsPerHour: 1000,
                maxConcurrentRequests: 10
            },
            inputValidation: {
                maxCommandLength: 1000,
                allowedCharacters: /^[a-zA-Z0-9\s\-_.\/~:]+$/,
                blockedCommands: ['rm -rf /', 'sudo rm -rf /*', 'dd if=/dev/zero']
            },
            securityHeaders: {
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block'
            },
            logging: {
                level: 'info',
                maxLogSize: '10MB',
                retentionDays: 30
            }
        };

        fs.writeFileSync('security-config.json', JSON.stringify(securityConfig, null, 2));
    }

    async setupRateLimiting() {
        console.log('Setting up rate limiting...');

        const rateLimitCode = `
import rateLimit from 'express-rate-limit';

export const createRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

export const aiRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // limit AI requests
    message: 'AI rate limit exceeded, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
`;

        fs.writeFileSync('pkg/ratelimit/middleware.go', rateLimitCode);
    }

    async implementInputValidation() {
        console.log('Implementing input validation...');

        const validationCode = `
package validation

import (
    "regexp"
    "strings"
    "unicode"
)

var (
    // Allowed command characters
    allowedCommandRegex = regexp.MustCompile(\`^[a-zA-Z0-9\\\\s\\\\-_.\\\\/~:]+$\\`)

    // Dangerous commands to block
    blockedCommands = []string{
        "rm -rf /",
        "sudo rm -rf /*",
        "dd if=/dev/zero",
        "mkfs",
        "fdisk",
    }
)

func ValidateCommand(command string) error {
    if len(command) > 1000 {
        return fmt.Errorf("command too long")
    }

    if !allowedCommandRegex.MatchString(command) {
        return fmt.Errorf("command contains invalid characters")
    }

    commandLower := strings.ToLower(command)
    for _, blocked := range blockedCommands {
        if strings.Contains(commandLower, blocked) {
            return fmt.Errorf("blocked command detected")
        }
    }

    return nil
}

func SanitizeInput(input string) string {
    // Remove null bytes and control characters
    return strings.Map(func(r rune) rune {
        if unicode.IsControl(r) && r != '\\n' && r != '\\t' {
            return -1
        }
        return r
    }, input)
}
`;

        fs.writeFileSync('pkg/validation/validation.go', validationCode);
    }

    async setupMonitoring() {
        console.log('Setting up monitoring and logging...');

        const monitoringConfig = {
            metrics: {
                responseTime: true,
                errorRate: true,
                throughput: true,
                agentPerformance: true
            },
            alerts: {
                highErrorRate: { threshold: 0.05, action: 'restart_agent' },
                slowResponse: { threshold: 5000, action: 'optimize_agent' },
                securityThreat: { threshold: 0, action: 'immediate_response' }
            },
            logging: {
                level: 'info',
                format: 'json',
                retention: '30d'
            }
        };

        fs.writeFileSync('monitoring-config.json', JSON.stringify(monitoringConfig, null, 2));
    }

    async createDocumentation() {
        console.log('Creating security documentation...');

        const securityDocs = `# Security Best Practices

## API Key Management
- Store API keys in environment variables only
- Never commit API keys to version control
- Rotate API keys regularly
- Use separate keys for development and production

## Input Validation
- Validate all user inputs
- Sanitize command parameters
- Block dangerous commands
- Limit input length

## Rate Limiting
- Implement rate limiting for all APIs
- Monitor for abuse patterns
- Use exponential backoff

## Error Handling
- Never expose sensitive information in errors
- Log security events for audit
- Implement proper error recovery

## Network Security
- Use HTTPS for all communications
- Validate SSL certificates
- Implement proper CORS policies

## Data Protection
- Encrypt sensitive data at rest
- Use secure random number generation
- Implement proper session management

## Monitoring
- Log all security events
- Monitor for suspicious activity
- Set up alerts for security incidents
`;

        fs.writeFileSync('SECURITY.md', securityDocs);
    }

    async setupCI() {
        console.log('Setting up CI/CD security...');

        const ciConfig = `name: Security CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Install dependencies
      run: npm ci
    - name: Run security audit
      run: npm audit --audit-level high
    - name: Run tests
      run: npm test
    - name: Check TypeScript
      run: npx tsc --noEmit
    - name: Security scan
      run: node scripts/security-audit.js
`;

        fs.writeFileSync('.github/workflows/security.yml', ciConfig);
    }
}

// Main execution
async function main() {
    const auditor = new SecurityAuditor();
    const bestPractices = new BestPractices();

    try {
        await auditor.runAudit();
        await bestPractices.implementBestPractices();

        console.log('\n🎉 Security audit and best practices implementation complete!');
        console.log('\n📋 Next steps:');
        console.log('  1. Review security-audit-report.json');
        console.log('  2. Update API keys in .env file');
        console.log('  3. Test the security improvements');
        console.log('  4. Monitor the security dashboard');

    } catch (error) {
        console.error('Error during audit:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
