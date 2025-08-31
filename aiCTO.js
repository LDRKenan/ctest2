const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../middleware/logger');

class AICTOMonitor {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
        
        this.monitoringInterval = null;
        this.alertThresholds = {
            errorRate: 0.05, // 5% error rate
            responseTime: 2000, // 2 seconds
            memoryUsage: 0.85, // 85% memory usage
            cpuUsage: 0.80 // 80% CPU usage
        };
    }

    async parseAIResponse(responseText) {
        try {
            // 1. First and best case scenario: The response is already clean JSON
            return JSON.parse(responseText);
        } catch (initialError) {
            logger.warn({
                message: 'Could not parse AI response directly, trying to trim...',
                error: initialError.message
            });

            try {
                // 2. Try to find the JSON in the response (between ```json ... ``` blocks)
                const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch && jsonMatch[1]) {
                    return JSON.parse(jsonMatch[1].trim());
                }

                // 3. Fallback: Only take everything between the first { and the last }
                const firstBrace = responseText.indexOf('{');
                const lastBrace = responseText.lastIndexOf('}');

                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const jsonString = responseText.substring(firstBrace, lastBrace + 1);
                    return JSON.parse(jsonString);
                }

                // 4. If none works, throw the error
                throw new Error('Could not extract JSON from AI response: ' + responseText.substring(0, 200));
            } catch (repairError) {
                logger.error({
                    message: 'Could not fix AI response',
                    originalError: initialError.message,
                    repairError: repairError.message,
                    responseSample: responseText.substring(0, 500) // First 500 characters to log
                });
                throw new Error(`Could not process AI response: ${repairError.message}`);
            }
        }
    }

    async startMonitoring(projectConfig) {
        try {
            logger.info({
                message: 'Starting AI CTO monitoring',
                project: projectConfig.name
            });

            // Initialize monitoring for deployed applications
            this.monitoringInterval = setInterval(async () => {
                await this.performHealthCheck(projectConfig);
                await this.analyzePerformanceMetrics(projectConfig);
                await this.checkSecurityVulnerabilities(projectConfig);
                await this.optimizeCodeSuggestions(projectConfig);
            }, 300000); // Check every 5 minutes

            return {
                status: 'monitoring_started',
                project: projectConfig.name,
                checkInterval: '5 minutes'
            };

        } catch (error) {
            logger.error({
                message: 'Failed to start AI CTO monitoring',
                error: error.message
            });
            throw error;
        }
    }

    async performHealthCheck(projectConfig) {
        try {
            const healthResults = {};
            
            // Check each platform endpoint
            for (const platform of projectConfig.platforms) {
                if (projectConfig.deploymentUrls[platform]) {
                    const health = await this.checkEndpointHealth(
                        projectConfig.deploymentUrls[platform],
                        platform
                    );
                    healthResults[platform] = health;
                }
            }

            // Analyze health results with AI
            const analysis = await this.analyzeHealthResults(healthResults);
            
            if (analysis.criticalIssues.length > 0) {
                await this.sendAlert('CRITICAL', analysis.criticalIssues, projectConfig);
            }

            return healthResults;

        } catch (error) {
            logger.error({
                message: 'Health check failed',
                error: error.message
            });
        }
    }

    async checkEndpointHealth(url, platform) {
        try {
            const axios = require('axios');
            const startTime = Date.now();
            
            const response = await axios.get(`${url}/health`, {
                timeout: 10000,
                validateStatus: () => true
            });
            
            const responseTime = Date.now() - startTime;
            
            return {
                platform,
                url,
                status: response.status,
                responseTime,
                healthy: response.status === 200,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                platform,
                url,
                status: 0,
                responseTime: null,
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async analyzeHealthResults(healthResults) {
        try {
            const prompt = `Analyze the following health check results. YOUR RESPONSE MUST BE IN THE FOLLOWING JSON TEMPLATE ONLY.

# DATA
${JSON.stringify(healthResults, null, 2)}

# ANALYSIS INSTRUCTIONS
1. Assess overall health: "healthy", "degraded", or "critical"
2. Identify critical issues and rank their severity
3. Offer specific, actionable solutions
4. Provide platform-based recommendations

# OUTPUT FORMAT
\`\`\`json
{
"overall_health": "healthy|degraded|critical",
"critical_issues": [
{
"platform": "web|ios|android|backend",
"issue": "string",
"severity": "high|medium|low",
"recommendation": "string"
}
],
"performance_insights": ["string"],
"optimization_suggestions": ["string"]
}
\`\`\`

Do not include any text other than JSON.`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert DevOps engineer and system architect. Analyze application health metrics and provide actionable insights."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 2000
            });

            return await this.parseAIResponse(response.choices[0].message.content);

        } catch (error) {
            logger.error({
                message: 'Health analysis failed',
                error: error.message
            });
            return {
                overall_health: 'unknown',
                criticalIssues: [],
                performanceInsights: [],
                optimizationSuggestions: []
            };
        }
    }

    async analyzePerformanceMetrics(projectConfig) {
        try {
            // Simulate gathering performance metrics
            const metrics = await this.gatherPerformanceMetrics(projectConfig);
            
            const analysisPrompt = `Analyze these performance metrics and provide optimization recommendations:

${JSON.stringify(metrics, null, 2)}

Focus on:
1. Database query optimization
2. API response time improvements
3. Frontend performance enhancements
4. Infrastructure scaling recommendations
5. Cost optimization opportunities

Return structured recommendations with priority levels.`;

            const response = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 3000,
                messages: [
                    {
                        role: "user",
                        content: analysisPrompt
                    }
                ]
            });

            const recommendations = JSON.parse(response.content[0].text);
            
            // Store recommendations for review
            await this.storeRecommendations(projectConfig.name, 'performance', recommendations);
            
            return recommendations;

        } catch (error) {
            logger.error({
                message: 'Performance analysis failed',
                error: error.message
            });
        }
    }

    async gatherPerformanceMetrics(projectConfig) {
        // In a real implementation, this would integrate with monitoring services
        // like DataDog, New Relic, CloudWatch, etc.
        return {
            timestamp: new Date().toISOString(),
            platforms: {
                web: {
                    responseTime: Math.random() * 1000 + 200,
                    errorRate: Math.random() * 0.1,
                    throughput: Math.random() * 1000 + 500,
                    memoryUsage: Math.random() * 0.8 + 0.1
                },
                backend: {
                    responseTime: Math.random() * 500 + 100,
                    errorRate: Math.random() * 0.05,
                    dbQueryTime: Math.random() * 200 + 50,
                    cpuUsage: Math.random() * 0.7 + 0.2
                },
                mobile: {
                    crashRate: Math.random() * 0.02,
                    appStartTime: Math.random() * 2000 + 1000,
                    batteryImpact: Math.random() * 0.3 + 0.1
                }
            }
        };
    }

    async checkSecurityVulnerabilities(projectConfig) {
        try {
            const securityPrompt = `Analyze the following project configuration for potential security vulnerabilities:

Project: ${projectConfig.name}
Platforms: ${projectConfig.platforms.join(', ')}
Tech Stack: ${JSON.stringify(projectConfig.techStack, null, 2)}
Dependencies: ${JSON.stringify(projectConfig.dependencies, null, 2)}

Identify:
1. Outdated dependencies with known vulnerabilities
2. Insecure configurations
3. Missing security headers
4. Authentication/authorization weaknesses
5. Data encryption gaps
6. API security issues

Provide specific remediation steps for each issue found.`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: "You are a cybersecurity expert specializing in application security. Identify vulnerabilities and provide actionable remediation steps."
                    },
                    {
                        role: "user",
                        content: securityPrompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 3000
            });

            const securityAnalysis = await this.parseAIResponse(response.choices[0].message.content);
            
            // Store security recommendations
            await this.storeRecommendations(projectConfig.name, 'security', securityAnalysis);
            
            // Send alerts for high-severity vulnerabilities
            const highSeverityIssues = securityAnalysis.vulnerabilities?.filter(v => v.severity === 'high') || [];
            if (highSeverityIssues.length > 0) {
                await this.sendAlert('SECURITY', highSeverityIssues, projectConfig);
            }
            
            return securityAnalysis;

        } catch (error) {
            logger.error({
                message: 'Security analysis failed',
                error: error.message
            });
        }
    }

    async optimizeCodeSuggestions(projectConfig) {
        try {
            // Analyze generated code for optimization opportunities
            const codeAnalysisPrompt = `Based on the following project configuration, suggest code optimizations and architectural improvements:

Project: ${projectConfig.name}
Platforms: ${projectConfig.platforms.join(', ')}
Features: ${projectConfig.features.join(', ')}

Provide suggestions for:
1. Code structure improvements
2. Performance optimizations
3. Maintainability enhancements
4. Scalability preparations
5. Testing strategies
6. Documentation improvements

Format as actionable recommendations with estimated impact and effort.`;

            const response = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 3000,
                messages: [
                    {
                        role: "user",
                        content: codeAnalysisPrompt
                    }
                ]
            });

            const optimizations = await this.parseAIResponse(response.content[0].text);
            
            await this.storeRecommendations(projectConfig.name, 'optimization', optimizations);
            
            return optimizations;

        } catch (error) {
            logger.error({
                message: 'Code optimization analysis failed',
                error: error.message
            });
        }
    }

    async storeRecommendations(projectName, type, recommendations) {
        try {
            const recommendationsDir = path.join('./recommendations', projectName);
            await fs.ensureDir(recommendationsDir);
            
            const filename = `${type}_${new Date().toISOString().split('T')[0]}.json`;
            const filepath = path.join(recommendationsDir, filename);
            
            await fs.writeJson(filepath, {
                timestamp: new Date().toISOString(),
                type,
                projectName,
                recommendations
            }, { spaces: 2 });

            logger.info({
                message: 'Recommendations stored',
                projectName,
                type,
                filepath
            });

        } catch (error) {
            logger.error({
                message: 'Failed to store recommendations',
                error: error.message
            });
        }
    }

    async sendAlert(severity, issues, projectConfig) {
        try {
            const alert = {
                timestamp: new Date().toISOString(),
                severity,
                project: projectConfig.name,
                issues,
                alertId: require('uuid').v4()
            };

            // Store alert
            const alertsDir = './alerts';
            await fs.ensureDir(alertsDir);
            await fs.writeJson(
                path.join(alertsDir, `${alert.alertId}.json`),
                alert,
                { spaces: 2 }
            );

            // In a real implementation, this would send notifications via:
            // - Email
            // - Slack
            // - Discord
            // - SMS
            // - Push notifications

            logger.warn({
                message: 'Alert generated',
                severity,
                project: projectConfig.name,
                issueCount: issues.length,
                alertId: alert.alertId
            });

            return alert;

        } catch (error) {
            logger.error({
                message: 'Failed to send alert',
                error: error.message
            });
        }
    }

    async generateStatusReport(projectName, timeRange = '24h') {
        try {
            const recommendationsDir = path.join('./recommendations', projectName);
            const alertsDir = './alerts';
            
            // Gather recent recommendations and alerts
            const recentRecommendations = await this.getRecentFiles(recommendationsDir, timeRange);
            const recentAlerts = await this.getRecentFiles(alertsDir, timeRange);
            
            const reportPrompt = `Generate a comprehensive status report for project "${projectName}" based on the following data:

Recent Recommendations:
${JSON.stringify(recentRecommendations, null, 2)}

Recent Alerts:
${JSON.stringify(recentAlerts, null, 2)}

Create a executive summary report including:
1. Overall system health status
2. Key performance metrics
3. Security posture
4. Critical issues requiring immediate attention
5. Optimization opportunities
6. Recommended next steps
7. Resource utilization trends

Format as a professional status report suitable for technical stakeholders.`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: "You are an AI CTO generating executive status reports. Provide clear, actionable insights for technical decision-makers."
                    },
                    {
                        role: "user",
                        content: reportPrompt
                    }
                ],
                temperature: 0.2,
                max_tokens: 4000
            });

            const report = {
                projectName,
                generatedAt: new Date().toISOString(),
                timeRange,
                content: response.choices[0].message.content,
                dataPoints: {
                    recommendationsCount: recentRecommendations.length,
                    alertsCount: recentAlerts.length
                }
            };

            // Store report
            const reportsDir = path.join('./reports', projectName);
            await fs.ensureDir(reportsDir);
            const reportFilename = `status_report_${new Date().toISOString().split('T')[0]}.json`;
            await fs.writeJson(path.join(reportsDir, reportFilename), report, { spaces: 2 });

            return report;

        } catch (error) {
            logger.error({
                message: 'Failed to generate status report',
                error: error.message
            });
            throw error;
        }
    }

    async getRecentFiles(directory, timeRange) {
        try {
            if (!await fs.pathExists(directory)) {
                return [];
            }

            const files = await fs.readdir(directory);
            const cutoffTime = this.getTimeRangeCutoff(timeRange);
            const recentFiles = [];

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const filePath = path.join(directory, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtime > cutoffTime) {
                    const content = await fs.readJson(filePath);
                    recentFiles.push(content);
                }
            }

            return recentFiles;

        } catch (error) {
            logger.error({
                message: 'Failed to get recent files',
                directory,
                error: error.message
            });
            return [];
        }
    }

    getTimeRangeCutoff(timeRange) {
        const now = new Date();
        const ranges = {
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        };
        
        const milliseconds = ranges[timeRange] || ranges['24h'];
        return new Date(now.getTime() - milliseconds);
    }

    async stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            
            logger.info({
                message: 'AI CTO monitoring stopped'
            });
        }
    }
}

module.exports = AICTOMonitor;
