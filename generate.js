const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const PlanningEngine = require('../services/planningEngine');
const CodeGenerator = require('../services/codeGenerator');
const JobManager = require('../services/jobManager');
const { logger } = require('../middleware/logger');

const router = express.Router();
const planningEngine = new PlanningEngine();
const codeGenerator = new CodeGenerator();
const jobManager = new JobManager();

// Validation schema
const generateSchema = Joi.object({
    description: Joi.string().min(10).max(2000).required(),
    platforms: Joi.array().items(
        Joi.string().valid('ios', 'android', 'web', 'backend')
    ).min(1).default(['ios', 'android', 'web', 'backend']),
    preferences: Joi.object({
        ui_framework: Joi.string().valid('swiftui', 'uikit', 'compose', 'react', 'vue', 'angular'),
        database: Joi.string().valid('mongodb', 'postgresql', 'mysql', 'firebase'),
        deployment: Joi.string().valid('aws', 'gcp', 'azure', 'vercel', 'netlify'),
        authentication: Joi.string().valid('firebase', 'auth0', 'custom', 'supabase')
    }).default({})
});

// POST /api/generate - Generate multi-platform app
router.post('/', async (req, res) => {
    try {
        // Validate input
        const { error, value } = generateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details.map(d => d.message)
            });
        }

        const { description, platforms, preferences } = value;
        const jobId = uuidv4();

        logger.info({
            message: 'New generation request',
            jobId,
            description: description.substring(0, 100),
            platforms,
            preferences
        });

        // Create job
        await jobManager.createJob(jobId, {
            type: 'generate',
            description,
            platforms,
            preferences,
            status: 'planning',
            createdAt: new Date()
        });

        // Start async generation process
        generateAppAsync(jobId, description, platforms, preferences);

        res.json({
            jobId,
            status: 'started',
            message: 'App generation started. Use /api/status/:jobId to check progress.',
            estimatedTime: '5-10 minutes',
            statusUrl: `/api/status/${jobId}`
        });

    } catch (error) {
        logger.error({
            message: 'Generate endpoint error',
            error: error.message
        });
        res.status(500).json({
            error: 'Failed to start generation process',
            details: error.message
        });
    }
});

// Async generation function
async function generateAppAsync(jobId, description, platforms, preferences) {
    try {
        // Update job status
        await jobManager.updateJob(jobId, { status: 'planning' });

        // Step 1: Planning phase
        logger.info({ message: 'Starting planning phase', jobId });
        const planningData = await planningEngine.analyzeDescription(description);
        
        // Apply user preferences
        if (preferences.database) {
            planningData.tech_stack.backend = planningData.tech_stack.backend.replace(/MongoDB|PostgreSQL|MySQL/, preferences.database);
        }
        
        planningData.platforms = platforms;
        
        await jobManager.updateJob(jobId, { 
            status: 'generating',
            planningData,
            progress: 25
        });

        // Step 2: Code generation phase
        logger.info({ message: 'Starting code generation phase', jobId });
        const generationResult = await codeGenerator.generateMultiPlatformApp(planningData, jobId);
        
        await jobManager.updateJob(jobId, {
            status: 'packaging',
            progress: 80
        });

        // Step 3: Package results
        logger.info({ message: 'Packaging results', jobId });
        const packagedResult = await packageGeneratedCode(jobId, generationResult);
        
        await jobManager.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            result: packagedResult,
            completedAt: new Date()
        });

        logger.info({ message: 'Generation completed successfully', jobId });

    } catch (error) {
        logger.error({
            message: 'Generation failed',
            jobId,
            error: error.message
        });
        
        await jobManager.updateJob(jobId, {
            status: 'failed',
            error: error.message,
            failedAt: new Date()
        });
    }
}

async function packageGeneratedCode(jobId, generationResult) {
    const archiver = require('archiver');
    const fs = require('fs-extra');
    const path = require('path');

    const outputDir = generationResult.outputDir;
    const zipPath = path.join('./generated', `${jobId}.zip`);
    
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    return new Promise((resolve, reject) => {
        output.on('close', () => {
            resolve({
                ...generationResult,
                zipPath,
                zipSize: archive.pointer(),
                downloadUrl: `/api/download/${jobId}`
            });
        });
        
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(outputDir, false);
        archive.finalize();
    });
}

module.exports = router;
