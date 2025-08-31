const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('../middleware/logger');

class CodeModernizer {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
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

    async modernizeCode(codeFiles, fromFramework, toFramework, additionalInstructions = '') {
        try {
            logger.info({
                message: 'Starting code modernization',
                fromFramework,
                toFramework,
                fileCount: codeFiles.length
            });

            const modernizationPrompt = this.buildModernizationPrompt(
                codeFiles, 
                fromFramework, 
                toFramework, 
                additionalInstructions
            );

            // Use Claude for complex code transformations
            const response = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 8000,
                messages: [
                    {
                        role: "user",
                        content: modernizationPrompt
                    }
                ]
            });

            const modernizedResult = await this.parseAIResponse(response.content[0].text);

            logger.info({
                message: 'Code modernization completed',
                filesGenerated: Object.keys(modernizedResult.files).length
            });

            return modernizedResult;

        } catch (error) {
            logger.error({
                message: 'Code modernization failed',
                error: error.message,
                fromFramework,
                toFramework
            });
            throw new Error(`Modernization failed: ${error.message}`);
        }
    }

    buildModernizationPrompt(codeFiles, fromFramework, toFramework, additionalInstructions = '') {
        return `
# TASK
Convert the following code from ${fromFramework} to ${toFramework}.

# SOURCE CODE
${codeFiles.map(file => `## FILE: ${file.name}
\`\`\`${file.extension}
${file.content}
\`\`\``).join('\n\n')}

# ADDITIONAL INSTRUCTIONS
${additionalInstructions || 'Let there be no loss of functionality. Use modern best practices.'}

# TRANSFORMATION RULES
1. Respond only in the following JSON format.
2. Each key in the "files" object should represent the target file path.
3. Provide COMPLETE and EXECUTABLE code for each file.
4. Update import/require statements to match the target framework.
5. Carefully handle syntax and API differences.

# OUTPUT FORMAT
\`\`\`json
{
"files": {
"path/to/new/file.swift": "// Full file content",
"another/file.kt": "// Full file content"
},
"migration_summary": {
"changes_made": ["string", "string"],
"new_dependencies": ["string"],
"removed_dependencies": ["string"],
"breaking_changes": ["string"],
"manual_steps": ["string"]
}
}
\`\`\`

# IMPORTANT
Your response must be in JSON format ONLY. Please follow this rule.
`;
    }

    async analyzeCodeComplexity(codeFiles) {
        try {
            const complexityPrompt = `Analyze the complexity and modernization potential of this codebase:

${codeFiles.map(file => `
File: ${file.name}
Lines: ${file.content.split('\n').length}
Extension: ${file.extension}
`).join('\n')}

Return a JSON analysis with complexity metrics, modernization opportunities, and estimated effort.`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: "You are a code analysis expert. Analyze codebases for complexity and modernization potential."
                    },
                    {
                        role: "user",
                        content: complexityPrompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 2000
            });

            return await this.parseAIResponse(response.choices[0].message.content);

        } catch (error) {
            logger.error({
                message: 'Code complexity analysis failed',
                error: error.message
            });
            throw error;
        }
    }

    async generateMigrationGuide(fromFramework, toFramework, codeAnalysis) {
        try {
            const guidePrompt = `Create a comprehensive migration guide for converting from ${fromFramework} to ${toFramework}.

Code Analysis Context:
${JSON.stringify(codeAnalysis, null, 2)}

Generate a detailed migration guide including:
1. Pre-migration checklist
2. Step-by-step migration process
3. Common pitfalls and solutions
4. Testing strategies
5. Post-migration optimization tips

Return as structured markdown.`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-4-turbo-preview",
                messages: [
                    {
                        role: "system",
                        content: "You are a technical documentation expert specializing in framework migrations."
                    },
                    {
                        role: "user",
                        content: guidePrompt
                    }
                ],
                temperature: 0.2,
                max_tokens: 3000
            });

            return response.choices[0].message.content;

        } catch (error) {
            logger.error({
                message: 'Migration guide generation failed',
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = CodeModernizer;
