const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const PlanningEngine = require('../services/planningEngine');
const CodeModernizer = require('../services/codeModernizer');
const JobManager = require('../services/jobManager');
const { logger } = require('../middleware/logger');

const router = express.Router();
const planningEngine = new PlanningEngine();
const codeModernizer = new CodeModernizer();
const jobManager = new JobManager();

// Configure multer for file uploads
const upload = multer({
    dest: './uploads/',
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.zip', '.tar', '.gz', '.js', '.ts', '.swift', '.kt', '.java', '.py'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext) || file.mimetype === 'application/zip') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload code files or archives.'));
        }
    }
});

// Validation schemas
const analyzeSchema = Joi.object({
    instruction: Joi.string().min(5).max(1000).required(),
    target_platform: Joi.string().valid('ios', 'android', 'web', 'backend').optional(),
    modernization_type: Joi.string().valid('framework', 'language', 'architecture', 'ui').optional()
});

// POST /api/analyze - Analyze existing codebase
router.post('/', upload.single('codebase'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No codebase file provided',
                message: 'Please upload a ZIP file or individual code files'
            });
        }

        // Validate input
        const { error, value } = analyzeSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details.map(d => d.message)
            });
        }

        const { instruction, target_platform, modernization_type } = value;
        const jobId = uuidv4();

        logger.info({
            message: 'New code analysis request',
            jobId,
            filename: req.file.originalname,
            instruction: instruction.substring(0, 100),
            target_platform,
            modernization_type
        });

        // Create job
        await jobManager.createJob(jobId, {
            type: 'analyze',
            instruction,
            target_platform,
            modernization_type,
            filename: req.file.originalname,
            status: 'extracting',
            createdAt: new Date()
        });

        // Start async analysis process
        analyzeCodeAsync(jobId, req.file, instruction, target_platform, modernization_type);

        res.json({
            jobId,
            status: 'started',
            message: 'Code analysis started. Use /api/status/:jobId to check progress.',
            estimatedTime: '3-7 minutes',
            statusUrl: `/api/status/${jobId}`
        });

    } catch (error) {
        logger.error({
            message: 'Analyze endpoint error',
            error: error.message
        });
        res.status(500).json({
            error: 'Failed to start analysis process',
            details: error.message
        });
    }
});

// POST /api/analyze/modernize - Modernize existing code
router.post('/modernize', upload.single('codebase'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No codebase file provided'
            });
        }

        const modernizeSchema = Joi.object({
            from_framework: Joi.string().required(),
            to_framework: Joi.string().required(),
            additional_instructions: Joi.string().max(500).optional()
        });

        const { error, value } = modernizeSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details.map(d => d.message)
            });
        }

        const { from_framework, to_framework, additional_instructions } = value;
        const jobId = uuidv4();

        logger.info({
            message: 'New code modernization request',
            jobId,
            filename: req.file.originalname,
            from_framework,
            to_framework
        });

        await jobManager.createJob(jobId, {
            type: 'modernize',
            from_framework,
            to_framework,
            additional_instructions,
            filename: req.file.originalname,
            status: 'extracting',
            createdAt: new Date()
        });

        modernizeCodeAsync(jobId, req.file, from_framework, to_framework, additional_instructions);

        res.json({
            jobId,
            status: 'started',
            message: 'Code modernization started.',
            estimatedTime: '5-15 minutes',
            statusUrl: `/api/status/${jobId}`
        });

    } catch (error) {
        logger.error({
            message: 'Modernize endpoint error',
            error: error.message
        });
        res.status(500).json({
            error: 'Failed to start modernization process',
            details: error.message
        });
    }
});

// Async analysis function
async function analyzeCodeAsync(jobId, file, instruction, targetPlatform, modernizationType) {
    try {
        // Step 1: Extract files
        await jobManager.updateJob(jobId, { status: 'extracting', progress: 10 });
        const extractedFiles = await extractCodeFiles(file);

        // Step 2: Analyze codebase
        await jobManager.updateJob(jobId, { status: 'analyzing', progress: 30 });
        const analysis = await planningEngine.analyzeExistingCode(extractedFiles);

        // Step 3: Generate recommendations
        await jobManager.updateJob(jobId, { status: 'generating_recommendations', progress: 70 });
        const recommendations = await generateRecommendations(analysis, instruction, targetPlatform, modernizationType);

        // Step 4: Complete
        await jobManager.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            result: {
                analysis,
                recommendations,
                files_analyzed: extractedFiles.length
            },
            completedAt: new Date()
        });

        logger.info({ message: 'Code analysis completed', jobId });

    } catch (error) {
        logger.error({
            message: 'Code analysis failed',
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

// Async modernization function
async function modernizeCodeAsync(jobId, file, fromFramework, toFramework, additionalInstructions) {
    try {
        await jobManager.updateJob(jobId, { status: 'extracting', progress: 10 });
        const extractedFiles = await extractCodeFiles(file);

        await jobManager.updateJob(jobId, { status: 'analyzing', progress: 25 });
        const analysis = await planningEngine.analyzeExistingCode(extractedFiles);

        await jobManager.updateJob(jobId, { status: 'modernizing', progress: 50 });
        const modernizedCode = await codeModernizer.modernizeCode(
            extractedFiles, 
            fromFramework, 
            toFramework, 
            additionalInstructions
        );

        await jobManager.updateJob(jobId, { status: 'packaging', progress: 85 });
        const packagedResult = await packageModernizedCode(jobId, modernizedCode);

        await jobManager.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            result: packagedResult,
            completedAt: new Date()
        });

        logger.info({ message: 'Code modernization completed', jobId });

    } catch (error) {
        logger.error({
            message: 'Code modernization failed',
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

async function extractCodeFiles(file) {
    const extractDir = path.join('./uploads', 'extracted', path.basename(file.filename));
    await fs.ensureDir(extractDir);

    if (file.mimetype === 'application/zip' || path.extname(file.originalname) === '.zip') {
        // Extract ZIP file
        await fs.createReadStream(file.path)
            .pipe(unzipper.Extract({ path: extractDir }))
            .promise();
    } else {
        // Single file
        await fs.copy(file.path, path.join(extractDir, file.originalname));
    }

    // Read all code files
    const codeFiles = [];
    const supportedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.swift', '.kt', '.java', '.py', '.go', '.rs'];
    
    async function readDirectory(dir) {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = await fs.stat(itemPath);
            
            if (stat.isDirectory()) {
                await readDirectory(itemPath);
            } else if (supportedExtensions.includes(path.extname(item))) {
                const content = await fs.readFile(itemPath, 'utf8');
                codeFiles.push({
                    name: path.relative(extractDir, itemPath),
                    extension: path.extname(item).substring(1),
                    content: content.substring(0, 10000) // Limit content size
                });
            }
        }
    }

    await readDirectory(extractDir);
    
    // Cleanup
    await fs.remove(file.path);
    await fs.remove(extractDir);
    
    return codeFiles;
}

async function generateRecommendations(analysis, instruction, targetPlatform, modernizationType) {
    // This would use AI to generate specific recommendations
    return {
        summary: "Code analysis completed",
        recommendations: [
            "Consider updating to latest framework version",
            "Implement proper error handling",
            "Add unit tests for critical functions"
        ],
        modernization_opportunities: [
            "Convert to modern UI framework",
            "Implement reactive programming patterns",
            "Add TypeScript for better type safety"
        ],
        estimated_effort: "Medium (2-4 weeks)"
    };
}

async function packageModernizedCode(jobId, modernizedCode) {
    const archiver = require('archiver');
    const outputDir = path.join('./generated', jobId);
    await fs.ensureDir(outputDir);

    // Write modernized files
    for (const [filePath, content] of Object.entries(modernizedCode.files)) {
        const fullPath = path.join(outputDir, filePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content);
    }

    // Create ZIP
    const zipPath = path.join('./generated', `${jobId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    return new Promise((resolve, reject) => {
        output.on('close', () => {
            resolve({
                modernizedCode,
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
