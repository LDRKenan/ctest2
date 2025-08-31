const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../middleware/logger');

class CodeGenerator {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
        
        this.agents = {
            ios: new IOSAgent(this.openai),
            android: new AndroidAgent(this.openai),
            web: new WebAgent(this.openai),
            backend: new BackendAgent(this.openai)
        };
    }

    async generateMultiPlatformApp(planningData, jobId) {
        try {
            logger.info({
                message: 'Starting multi-platform code generation',
                jobId,
                platforms: planningData.platforms
            });

            const outputDir = path.join('./generated', jobId);
            await fs.ensureDir(outputDir);

            const results = {};
            
            // Generate code for each platform in parallel
            const generationPromises = planningData.platforms.map(async (platform) => {
                if (this.agents[platform]) {
                    const platformDir = path.join(outputDir, platform);
                    await fs.ensureDir(platformDir);
                    
                    const code = await this.agents[platform].generateCode(planningData, platformDir);
                    results[platform] = {
                        success: true,
                        files: code.files,
                        structure: code.structure
                    };
                } else {
                    results[platform] = {
                        success: false,
                        error: `Platform ${platform} not supported`
                    };
                }
            });

            await Promise.all(generationPromises);

            // Generate project documentation
            await this.generateDocumentation(planningData, outputDir);

            logger.info({
                message: 'Multi-platform code generation completed',
                jobId,
                results: Object.keys(results)
            });

            return {
                jobId,
                outputDir,
                results,
                downloadUrl: `/api/download/${jobId}`
            };

        } catch (error) {
            logger.error({
                message: 'Code generation failed',
                jobId,
                error: error.message
            });
            throw error;
        }
    }

    async generateDocumentation(planningData, outputDir) {
        const readmeContent = `# ${planningData.app_name}

${planningData.description}

## Features
${planningData.features.map(feature => `- ${feature}`).join('\n')}

## Tech Stack
${Object.entries(planningData.tech_stack).map(([platform, tech]) => 
    `- **${platform.toUpperCase()}**: ${tech}`
).join('\n')}

## API Endpoints
${planningData.api_endpoints.map(endpoint => 
    `- \`${endpoint.method} ${endpoint.path}\` - ${endpoint.description}`
).join('\n')}

## Getting Started

### Backend
\`\`\`bash
cd backend
npm install
npm start
\`\`\`

### Web
\`\`\`bash
cd web
npm install
npm run dev
\`\`\`

### iOS
1. Open \`ios/App.xcodeproj\` in Xcode
2. Build and run

### Android
1. Open \`android/\` in Android Studio
2. Build and run

## Deployment
${Object.entries(planningData.deployment).map(([platform, service]) => 
    `- **${platform.toUpperCase()}**: ${service}`
).join('\n')}
`;

        await fs.writeFile(path.join(outputDir, 'README.md'), readmeContent);
    }
}

class IOSAgent {
    constructor(openai) {
        this.openai = openai;
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

    async generateCode(planningData, outputDir) {
        const prompt = this.buildIOSPrompt(planningData);
        
        const response = await this.openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                {
                    role: "system",
                    content: "You are an expert iOS developer specializing in SwiftUI. Generate clean, modern, production-ready iOS code."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.2,
            max_tokens: 4000
        });

        const codeStructure = await this.parseAIResponse(response.choices[0].message.content);
        
        // Write files to disk
        const files = [];
        for (const [filePath, content] of Object.entries(codeStructure.files)) {
            const fullPath = path.join(outputDir, filePath);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content);
            files.push(filePath);
        }

        return {
            files,
            structure: codeStructure.structure
        };
    }

    buildIOSPrompt(planningData) {
        return `
# TASK
Generate code for a complete iOS SwiftUI app based on the following specification.

# TECHNICAL SPECIFICATION
${JSON.stringify(planningData, null, 2)}

# INSTRUCTIONS
1. Provide your entire response in accordance with the following JSON template.
2. Write nothing BUT JSON.
3. Provide a COMPLETE and WORKING code content for each file in the "files" object.
4. Write code using modern SwiftUI and Combine.
5. Add proper imports, error handling, and state management.
6. AVOID using escape characters in JSON (use real newlines and tabs instead of \\n, \\t).

# JSON TEMPLATE
\`\`\`json
{
"files": {
"App.swift": "// Full SwiftUI App struct content",
"ContentView.swift": "// Main view content",
"Models/User.swift": "// Model struct content",
"Services/NetworkManager.swift": "// API service class content",
"Views/LoginView.swift": "// Login view content",
"Views/ProfileView.swift": "// Profile view content"
},
"structure": {
"architecture": "MVVM",
"frameworks": ["SwiftUI", "Combine", "Foundation"],
"features_implemented": ["Login", "Profile View"]
}
}
\`\`\`

# SAMPLE FILE CONTENTS (App.swift)
\`\`\`swift
import SwiftUI

@main
struct MyApp: App {
var body: some Scene {
WindowGroup {
ContentView()
}
}
}
\`\`\`

Your response must be in JSON format ONLY. Please follow this rule.
`;
    }
}

class AndroidAgent {
    constructor(openai) {
        this.openai = openai;
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

    async generateCode(planningData, outputDir) {
        const prompt = this.buildAndroidPrompt(planningData);
        
        const response = await this.openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                {
                    role: "system",
                    content: "You are an expert Android developer specializing in Kotlin and Jetpack Compose. Generate clean, modern Android code."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.2,
            max_tokens: 4000
        });

        const codeStructure = await this.parseAIResponse(response.choices[0].message.content);
        
        const files = [];
        for (const [filePath, content] of Object.entries(codeStructure.files)) {
            const fullPath = path.join(outputDir, filePath);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content);
            files.push(filePath);
        }

        return {
            files,
            structure: codeStructure.structure
        };
    }

    buildAndroidPrompt(planningData) {
        return `
# TASK
Generate code for a complete Android Kotlin app with Jetpack Compose based on the following specification.

# TECHNICAL SPECIFICATION
${JSON.stringify(planningData, null, 2)}

# INSTRUCTIONS
1. Provide your entire response in accordance with the following JSON template.
2. Write nothing BUT JSON.
3. Provide a COMPLETE and WORKING code content for each file in the "files" object.
4. Write code using modern Kotlin and Jetpack Compose.
5. Add proper imports, error handling, and state management.
6. AVOID using escape characters in JSON (use real newlines and tabs instead of \\n, \\t).

# JSON TEMPLATE
\`\`\`json
{
"files": {
"MainActivity.kt": "// Main activity content",
"ui/theme/Theme.kt": "// Theme configuration",
"data/models/User.kt": "// Model data class content",
"data/network/ApiService.kt": "// API service interface content",
"ui/screens/LoginScreen.kt": "// Login screen composable",
"ui/screens/ProfileScreen.kt": "// Profile screen composable"
},
"structure": {
"architecture": "MVVM",
"frameworks": ["Jetpack Compose", "Retrofit", "Hilt"],
"features_implemented": ["Login", "Profile View"]
}
}
\`\`\`

Your response must be in JSON format ONLY. Please follow this rule.
`;
    }
}

class WebAgent {
    constructor(openai) {
        this.openai = openai;
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

    async generateCode(planningData, outputDir) {
        const prompt = this.buildWebPrompt(planningData);
        
        const response = await this.openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                {
                    role: "system",
                    content: "You are an expert full-stack web developer specializing in Next.js, TypeScript, and modern web technologies."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.2,
            max_tokens: 4000
        });

        const codeStructure = await this.parseAIResponse(response.choices[0].message.content);
        
        const files = [];
        for (const [filePath, content] of Object.entries(codeStructure.files)) {
            const fullPath = path.join(outputDir, filePath);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content);
            files.push(filePath);
        }

        return {
            files,
            structure: codeStructure.structure
        };
    }

    buildWebPrompt(planningData) {
        return `
# TASK
Generate code for a complete Next.js web application based on the following specification.

# TECHNICAL SPECIFICATION
${JSON.stringify(planningData, null, 2)}

# INSTRUCTIONS
1. Provide your entire response in accordance with the following JSON template.
2. Write nothing BUT JSON.
3. Provide a COMPLETE and WORKING code content for each file in the "files" object.
4. Write code using modern Next.js 14, TypeScript, and Tailwind CSS.
5. Add proper imports, error handling, and state management.
6. AVOID using escape characters in JSON (use real newlines and tabs instead of \\n, \\t).

# JSON TEMPLATE
\`\`\`json
{
"files": {
"app/page.tsx": "// Main page component",
"app/layout.tsx": "// Root layout component",
"components/ui/Button.tsx": "// Button component",
"lib/api.ts": "// API utility functions",
"app/login/page.tsx": "// Login page component",
"app/profile/page.tsx": "// Profile page component"
},
"structure": {
"architecture": "App Router",
"frameworks": ["Next.js 14", "TypeScript", "Tailwind CSS"],
"features_implemented": ["Login", "Profile View"]
}
}
\`\`\`

Your response must be in JSON format ONLY. Please follow this rule.
`;
    }
}

class BackendAgent {
    constructor(openai) {
        this.openai = openai;
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

    async generateCode(planningData, outputDir) {
        const prompt = this.buildBackendPrompt(planningData);
        
        const response = await this.openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                {
                    role: "system",
                    content: "You are an expert backend developer specializing in Node.js, Express, and database design."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.2,
            max_tokens: 4000
        });

        const codeStructure = await this.parseAIResponse(response.choices[0].message.content);
        
        const files = [];
        for (const [filePath, content] of Object.entries(codeStructure.files)) {
            const fullPath = path.join(outputDir, filePath);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content);
            files.push(filePath);
        }

        return {
            files,
            structure: codeStructure.structure
        };
    }

    buildBackendPrompt(planningData) {
        return `
# TASK
Generate code for a complete Node.js Express backend API based on the following specification.

# TECHNICAL SPECIFICATION
${JSON.stringify(planningData, null, 2)}

# INSTRUCTIONS
1. Provide your entire response in accordance with the following JSON template.
2. Write nothing BUT JSON.
3. Provide a COMPLETE and WORKING code content for each file in the "files" object.
4. Write code using modern Node.js, Express, and MongoDB.
5. Add proper imports, error handling, and validation.
6. AVOID using escape characters in JSON (use real newlines and tabs instead of \\n, \\t).

# JSON TEMPLATE
\`\`\`json
{
"files": {
"server.js": "// Express server setup",
"models/User.js": "// Mongoose user model",
"routes/auth.js": "// Authentication routes",
"routes/api.js": "// API routes",
"middleware/auth.js": "// Authentication middleware",
"config/database.js": "// Database configuration"
},
"structure": {
"architecture": "MVC",
"frameworks": ["Express.js", "MongoDB", "Mongoose", "JWT"],
"features_implemented": ["Authentication", "API Endpoints"]
}
}
\`\`\`

Your response must be in JSON format ONLY. Please follow this rule.
`;
    }
}

module.exports = CodeGenerator;
