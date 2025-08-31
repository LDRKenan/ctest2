const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const JobManager = require('../services/jobManager');
const { logger } = require('../middleware/logger');

const router = express.Router();
const jobManager = new JobManager();

// GET /api/status/:jobId - Get job status
router.get('/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await jobManager.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                error: 'Job not found',
                jobId
            });
        }

        res.json({
            jobId,
            status: job.status,
            progress: job.progress || 0,
            type: job.type,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
            failedAt: job.failedAt,
            error: job.error,
            result: job.result,
            estimatedTimeRemaining: calculateEstimatedTime(job)
        });

    } catch (error) {
        logger.error({
            message: 'Status check error',
            jobId: req.params.jobId,
            error: error.message
        });
        res.status(500).json({
            error: 'Failed to get job status',
            details: error.message
        });
    }
});

// GET /api/download/:jobId - Download generated code
router.get('/download/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await jobManager.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                error: 'Job not found',
                jobId
            });
        }

        if (job.status !== 'completed') {
            return res.status(400).json({
                error: 'Job not completed yet',
                status: job.status,
                progress: job.progress
            });
        }

        const zipPath = path.join('./generated', `${jobId}.zip`);
        
        if (!await fs.pathExists(zipPath)) {
            return res.status(404).json({
                error: 'Generated files not found',
                message: 'The generated code may have been cleaned up or the job failed'
            });
        }

        const stats = await fs.stat(zipPath);
        const filename = `${job.type}_${jobId}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stats.size);

        const fileStream = fs.createReadStream(zipPath);
        fileStream.pipe(res);

        logger.info({
            message: 'Code download initiated',
            jobId,
            filename,
            size: stats.size
        });

    } catch (error) {
        logger.error({
            message: 'Download error',
            jobId: req.params.jobId,
            error: error.message
        });
        res.status(500).json({
            error: 'Failed to download files',
            details: error.message
        });
    }
});

// DELETE /api/status/:jobId - Cancel job
router.delete('/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await jobManager.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                error: 'Job not found',
                jobId
            });
        }

        if (job.status === 'completed' || job.status === 'failed') {
            return res.status(400).json({
                error: 'Cannot cancel completed or failed job',
                status: job.status
            });
        }

        await jobManager.updateJob(jobId, {
            status: 'cancelled',
            cancelledAt: new Date()
        });

        logger.info({
            message: 'Job cancelled',
            jobId
        });

        res.json({
            jobId,
            status: 'cancelled',
            message: 'Job has been cancelled'
        });

    } catch (error) {
        logger.error({
            message: 'Job cancellation error',
            jobId: req.params.jobId,
            error: error.message
        });
        res.status(500).json({
            error: 'Failed to cancel job',
            details: error.message
        });
    }
});

function calculateEstimatedTime(job) {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return 0;
    }

    const baseEstimates = {
        generate: 8 * 60, // 8 minutes
        analyze: 5 * 60,  // 5 minutes
        modernize: 10 * 60 // 10 minutes
    };

    const baseTime = baseEstimates[job.type] || 5 * 60;
    const progress = job.progress || 0;
    const remainingProgress = 100 - progress;
    
    return Math.ceil((baseTime * remainingProgress) / 100);
}

module.exports = router;
