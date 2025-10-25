/**
 * Best Practices Configuration for Hyper-Intelligent Terminal
 * Implements security, performance, and maintainability standards
 */

export const BEST_PRACTICES = {
    security: {
        inputValidation: {
            maxCommandLength: 1000,
            maxPathLength: 260,
            allowedCharacters: /^[a-zA-Z0-9\s\-_.\/~:]+$/,
            blockedPatterns: [
                /\.\.[\/\\]/,  // Directory traversal
                /rm\s+-rf\s*\/[\/\*]?/,  // Dangerous rm commands
                /sudo\s+rm\s+-rf/,  // Dangerous sudo rm
                /eval\s*\(/,  // Code injection
                /exec\s*\(/   // Command injection
            ]
        },

        rateLimiting: {
            maxRequestsPerMinute: 100,
            maxRequestsPerHour: 1000,
            maxConcurrentRequests: 10,
            burstLimit: 20
        },

        accessControl: {
            allowLocalhostOnly: true,
            requireHttps: true,
            validateOrigins: true,
            sessionTimeout: 3600 // 1 hour
        },

        dataProtection: {
            encryptApiKeys: true,
            hashSensitiveData: true,
            secureRandomGeneration: true,
            auditLogging: true
        }
    },

    performance: {
        optimization: {
            responseTimeTarget: 500, // ms
            memoryLimit: 512, // MB
            cpuLimit: 70, // %
            cacheSize: 1000,
            cacheTTL: 300000 // 5 minutes
        },

        monitoring: {
            metricsInterval: 30000, // 30 seconds
            alertThresholds: {
                highCpu: 80,
                highMemory: 85,
                slowResponse: 2000,
                errorRate: 5
            }
        },

        agentCoordination: {
            maxConcurrentAgents: 8,
            agentTimeout: 10000,
            retryAttempts: 3,
            backoffMultiplier: 1.5
        }
    },

    codeQuality: {
        typescript: {
            strict: true,
            noImplicitAny: true,
            noImplicitReturns: true,
            noImplicitThis: true,
            noUnusedLocals: true,
            noUnusedParameters: true
        },

        testing: {
            coverage: {
                statements: 80,
                branches: 75,
                functions: 80,
                lines: 80
            },
            testTypes: ['unit', 'integration', 'e2e', 'security']
        },

        linting: {
            eslint: {
                extends: ['@typescript-eslint/recommended', 'prettier'],
                rules: {
                    'no-console': 'warn',
                    'no-debugger': 'error',
                    'prefer-const': 'error',
                    'no-var': 'error'
                }
            },
            prettier: {
                semi: true,
                singleQuote: true,
                tabWidth: 4,
                useTabs: false
            }
        }
    },

    architecture: {
        modularity: {
            maxFileSize: 500, // lines
            maxFunctionComplexity: 10,
            maxClassSize: 200,
            interfaceSegregation: true
        },

        patterns: {
            dependencyInjection: true,
            observerPattern: true,
            factoryPattern: true,
            singletonPattern: true
        },

        errorHandling: {
            globalErrorHandler: true,
            specificErrorTypes: true,
            errorRecovery: true,
            gracefulDegradation: true
        }
    }
};

/**
 * Input validation utilities
 */
export class InputValidator {
    static validateCommand(command: string): { valid: boolean; error?: string } {
        const config = BEST_PRACTICES.security.inputValidation;

        if (command.length > config.maxCommandLength) {
            return { valid: false, error: 'Command too long' };
        }

        if (!config.allowedCharacters.test(command)) {
            return { valid: false, error: 'Command contains invalid characters' };
        }

        for (const pattern of config.blockedPatterns) {
            if (pattern.test(command)) {
                return { valid: false, error: 'Blocked command pattern detected' };
            }
        }

        return { valid: true };
    }

    static sanitizePath(path: string): { valid: boolean; sanitized?: string; error?: string } {
        const config = BEST_PRACTICES.security.inputValidation;

        if (path.length > config.maxPathLength) {
            return { valid: false, error: 'Path too long' };
        }

        // Remove directory traversal attempts
        const sanitized = path.replace(/\.\.[\/\\]/g, '');

        if (sanitized !== path) {
            return { valid: false, error: 'Directory traversal detected' };
        }

        return { valid: true, sanitized };
    }

    static validateEnvironment(): { valid: boolean; issues: string[] } {
        const issues: string[] = [];
        const config = BEST_PRACTICES.security;

        // Check API keys
        const requiredKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
        for (const key of requiredKeys) {
            if (!process.env[key] || process.env[key]?.includes('your_') || process.env[key]?.includes('placeholder')) {
                issues.push(`Missing or placeholder ${key}`);
            }
        }

        // Check security settings
        if (!config.accessControl.requireHttps) {
            issues.push('HTTPS not required for production');
        }

        // Check rate limiting
        if (config.rateLimiting.maxRequestsPerMinute > 200) {
            issues.push('Rate limiting too permissive');
        }

        return { valid: issues.length === 0, issues };
    }
}

/**
 * Rate limiting implementation
 */
export class RateLimiter {
    private requests: Map<string, number[]> = new Map();
    private config = BEST_PRACTICES.security.rateLimiting;

    checkRateLimit(identifier: string): { allowed: boolean; resetTime?: number } {
        const now = Date.now();
        const windowStart = now - 60000; // 1 minute window

        if (!this.requests.has(identifier)) {
            this.requests.set(identifier, []);
        }

        const userRequests = this.requests.get(identifier)!;

        // Remove old requests outside the window
        const recentRequests = userRequests.filter(time => time > windowStart);
        this.requests.set(identifier, recentRequests);

        if (recentRequests.length >= this.config.maxRequestsPerMinute) {
            const oldestRequest = Math.min(...recentRequests);
            return {
                allowed: false,
                resetTime: oldestRequest + 60000
            };
        }

        recentRequests.push(now);
        return { allowed: true };
    }

    getRemainingRequests(identifier: string): number {
        const now = Date.now();
        const windowStart = now - 60000;

        if (!this.requests.has(identifier)) {
            return this.config.maxRequestsPerMinute;
        }

        const recentRequests = this.requests.get(identifier)!
            .filter(time => time > windowStart);

        return Math.max(0, this.config.maxRequestsPerMinute - recentRequests.length);
    }
}

/**
 * Performance monitoring
 */
export class PerformanceMonitor {
    private metrics: Map<string, number[]> = new Map();
    private config = BEST_PRACTICES.performance.monitoring;

    recordMetric(name: string, value: number): void {
        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }

        const values = this.metrics.get(name)!;
        values.push(value);

        // Keep only last 1000 measurements
        if (values.length > 1000) {
            values.splice(0, values.length - 1000);
        }
    }

    getAverageMetric(name: string): number {
        const values = this.metrics.get(name);
        if (!values || values.length === 0) return 0;

        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    checkAlerts(): { name: string; triggered: boolean; message: string }[] {
        const alerts: { name: string; triggered: boolean; message: string }[] = [];

        const thresholds = this.config.alertThresholds;

        const avgResponseTime = this.getAverageMetric('response_time');
        if (avgResponseTime > thresholds.slowResponse) {
            alerts.push({
                name: 'slow_response',
                triggered: true,
                message: `Average response time ${avgResponseTime.toFixed(0)}ms exceeds threshold ${thresholds.slowResponse}ms`
            });
        }

        const avgCpu = this.getAverageMetric('cpu_usage');
        if (avgCpu > thresholds.highCpu) {
            alerts.push({
                name: 'high_cpu',
                triggered: true,
                message: `CPU usage ${avgCpu.toFixed(1)}% exceeds threshold ${thresholds.highCpu}%`
            });
        }

        const avgMemory = this.getAverageMetric('memory_usage');
        if (avgMemory > thresholds.highMemory) {
            alerts.push({
                name: 'high_memory',
                triggered: true,
                message: `Memory usage ${avgMemory.toFixed(1)}% exceeds threshold ${thresholds.highMemory}%`
            });
        }

        return alerts;
    }

    getSystemHealth(): {
        score: number;
        status: 'healthy' | 'warning' | 'critical';
        issues: string[];
    } {
        const alerts = this.checkAlerts();
        const criticalAlerts = alerts.filter(a => a.triggered);

        let score = 100;
        const issues: string[] = [];

        for (const alert of criticalAlerts) {
            switch (alert.name) {
                case 'slow_response':
                    score -= 30;
                    issues.push('Response times are too slow');
                    break;
                case 'high_cpu':
                    score -= 25;
                    issues.push('High CPU usage detected');
                    break;
                case 'high_memory':
                    score -= 25;
                    issues.push('High memory usage detected');
                    break;
            }
        }

        let status: 'healthy' | 'warning' | 'critical' = 'healthy';
        if (score < 50) status = 'critical';
        else if (score < 80) status = 'warning';

        return { score, status, issues };
    }
}

/**
 * Code quality utilities
 */
export class CodeQuality {
    static validateTypeScript(filePath: string): { valid: boolean; errors: string[] } {
        const config = BEST_PRACTICES.codeQuality.typescript;
        const errors: string[] = [];

        // This would integrate with TypeScript compiler API
        // For now, return mock validation
        return { valid: true, errors };
    }

    static checkComplexity(code: string): {
        complexity: number;
        maintainability: 'high' | 'medium' | 'low';
        suggestions: string[];
    } {
        const lines = code.split('\n').length;
        const functions = (code.match(/function|=>|async\s+function/g) || []).length;
        const conditions = (code.match(/\bif\b|\bwhile\b|\bfor\b|\bswitch\b/g) || []).length;

        const complexity = (functions * 2) + (conditions * 1) + (lines / 50);
        const maintainability: 'high' | 'medium' | 'low' =
            complexity < 10 ? 'high' : complexity < 25 ? 'medium' : 'low';

        const suggestions: string[] = [];
        if (complexity > 25) {
            suggestions.push('Consider breaking down complex functions');
        }
        if (lines > 500) {
            suggestions.push('File is too large, consider splitting');
        }

        return { complexity, maintainability, suggestions };
    }

    static generateDocumentation(componentName: string, code: string): string {
        const functions = code.match(/(\w+)\s*\([^)]*\)\s*[:{]/g) || [];
        const comments = code.match(/\/\*\*[\s\S]*?\*\//g) || [];

        return `# ${componentName}

## Overview
Auto-generated documentation for ${componentName}

## Functions
${functions.map(fn => `- \`${fn.replace(/[{}:]/g, '').trim()}\``).join('\n')}

## Complexity
${this.checkComplexity(code).maintainability} maintainability

## Comments
${comments.length} documentation blocks found
`;
    }
}

/**
 * Architecture validation
 */
export class ArchitectureValidator {
    static validateModularity(filePath: string): {
        score: number;
        issues: string[];
        recommendations: string[];
    } {
        const issues: string[] = [];
        const recommendations: string[] = [];
        let score = 100;

        // Check file size
        const stats = require('fs').statSync(filePath);
        if (stats.size > 50000) { // ~500 lines assuming 100 chars per line
            issues.push('File is too large');
            score -= 20;
        }

        // Check for multiple responsibilities
        const content = require('fs').readFileSync(filePath, 'utf8');
        const classes = (content.match(/class\s+\w+/g) || []).length;
        const functions = (content.match(/function\s+\w+|const\s+\w+\s*=/g) || []).length;

        if (classes > 3) {
            issues.push('Multiple classes in single file');
            score -= 15;
        }

        if (functions > 20) {
            recommendations.push('Consider splitting into multiple modules');
            score -= 10;
        }

        return { score, issues, recommendations };
    }

    static validatePatterns(code: string): {
        patterns: string[];
        missing: string[];
        violations: string[];
    } {
        const patterns: string[] = [];
        const missing: string[] = [];
        const violations: string[] = [];

        // Check for dependency injection
        if (code.includes('constructor') && code.includes('inject')) {
            patterns.push('Dependency Injection');
        } else {
            missing.push('Dependency Injection');
        }

        // Check for error handling patterns
        if (code.includes('try') && code.includes('catch')) {
            patterns.push('Error Handling');
        } else {
            missing.push('Error Handling');
        }

        // Check for observer pattern
        if (code.includes('addEventListener') || code.includes('emit') || code.includes('on(')) {
            patterns.push('Observer Pattern');
        }

        return { patterns, missing, violations };
    }
}

export default {
    BEST_PRACTICES,
    InputValidator,
    RateLimiter,
    PerformanceMonitor,
    CodeQuality,
    ArchitectureValidator
};
