const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('../middleware/logger');

class PlanningEngine {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
    }

    async analyzeDescription(description) {
        try {
            const prompt = this.buildPlanningPrompt(description);
            
            // Use OpenAI GPT-4 for planning
            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert software architect. Analyze app descriptions and create detailed technical specifications."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            });

            const planningData = await this.parseAIResponse(response.choices[0].message.content);
            
            logger.info({
                message: 'Planning analysis completed',
                features: planningData.features?.length || 0,
                platforms: planningData.platforms?.length || 0
            });

            return planningData;
        } catch (error) {
            logger.error({
                message: 'Planning engine error',
                error: error.message,
                description: description.substring(0, 100)
            });
            throw new Error(`Planning analysis failed: ${error.message}`);
        }
    }

    buildPlanningPrompt(description) {
        return `
# TASK
Analyze the following application description and create a comprehensive technical specification.

# APPLICATION DESCRIPTION
"${description}"

# INSTRUCTIONS
1. ONLY provide a response that fully complies with the following JSON template.
2. Do not include any descriptions, comments, or additional text outside of the JSON.
3. Create an English, single-word, or hyphenated name for "app_name".
4. Recommend modern, popular, and scalable stacks for technologies (e.g., Next.js 14, SwiftUI, Kotlin, Node.js, MongoDB).
5. List features and user stories in a realistic and actionable manner.

# JSON TEMPLATE
\`\`\`json
{ 
"app_name": "string", 
"description": "string", 
"platforms": ["ios", "android", "web", "backend"], 
"features": ["string", "string"], 
"user_stories": ["string", "string"], 
"database_schema": { 
"collection_name": { 
"fields": ["string", "string"], 
"relationships": ["string"] 
} 
}, 
"ui_components": { 
"shared": ["string"], 
"ios": ["string"], 
"android": ["string"], 
"web": ["string"] 
}, 
"integrations": [ 
{ 
"name": "string", 
"service": "string", 
"purpose": "string" 
} 
], 
"api_endpoints": [ 
{ 
"method": "GET|POST|PUT|DELETE", 
"path": "string", 
"description": "string" 
} 
], 
"tech_stack": { 
"ios": "string", 
"android": "string", 
"web": "string", 
"backend": "string" 
}, 
"deployment": { 
"ios": "string", 
"android": "string", 
"web": "string", 
"backend": "string" 
}
}
\`\`\`

# IMPORTANT NOTICE
Your response must be in JSON format ONLY. Please follow this rule.
`;
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

    async analyzeExistingCode(codeFiles) {
        try {
            const codeAnalysis = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 4000,
                messages: [
                    {
                        role: "user",
                        content: `Analyze the following codebase and extract its structure, features, and technologies:

${codeFiles.map(file => `
File: ${file.name}
\`\`\`${file.extension}
${file.content}
\`\`\`
`).join('\n')}

Return a JSON object describing the codebase structure, identified features, technologies used, and suggestions for modernization.`
                    }
                ]
            });

            return await this.parseAIResponse(codeAnalysis.content[0].text);
        } catch (error) {
            logger.error({
                message: 'Code analysis error',
                error: error.message
            });
            throw new Error(`Code analysis failed: ${error.message}`);
        }
    }
}

module.exports = PlanningEngine;
