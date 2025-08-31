const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../middleware/logger');

class JobManager {
    constructor() {
        this.jobsDir = './jobs';
        this.ensureJobsDirectory();
    }

    async ensureJobsDirectory() {
        await fs.ensureDir(this.jobsDir);
    }

    async createJob(jobId, jobData) {
        try {
            const jobPath = path.join(this.jobsDir, `${jobId}.json`);
            const job = {
                id: jobId,
                ...jobData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await fs.writeJson(jobPath, job, { spaces: 2 });
            
            logger.info({
                message: 'Job created',
                jobId,
                type: jobData.type
            });

            return job;
        } catch (error) {
            logger.error({
                message: 'Failed to create job',
                jobId,
                error: error.message
            });
            throw error;
        }
    }

    async getJob(jobId) {
        try {
            const jobPath = path.join(this.jobsDir, `${jobId}.json`);
            
            if (!await fs.pathExists(jobPath)) {
                return null;
            }

            return await fs.readJson(jobPath);
        } catch (error) {
            logger.error({
                message: 'Failed to get job',
                jobId,
                error: error.message
            });
            return null;
        }
    }

    async updateJob(jobId, updates) {
        try {
            const job = await this.getJob(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }

            const updatedJob = {
                ...job,
                ...updates,
                updatedAt: new Date().toISOString()
            };

            const jobPath = path.join(this.jobsDir, `${jobId}.json`);
            await fs.writeJson(jobPath, updatedJob, { spaces: 2 });

            logger.info({
                message: 'Job updated',
                jobId,
                status: updatedJob.status,
                progress: updatedJob.progress
            });

            return updatedJob;
        } catch (error) {
            logger.error({
                message: 'Failed to update job',
                jobId,
                error: error.message
            });
            throw error;
        }
    }

    async deleteJob(jobId) {
        try {
            const jobPath = path.join(this.jobsDir, `${jobId}.json`);
            await fs.remove(jobPath);
            
            logger.info({
                message: 'Job deleted',
                jobId
            });
        } catch (error) {
            logger.error({
                message: 'Failed to delete job',
                jobId,
                error: error.message
            });
            throw error;
        }
    }

    async listJobs(limit = 50, offset = 0) {
        try {
            const files = await fs.readdir(this.jobsDir);
            const jobFiles = files.filter(f => f.endsWith('.json'));
            
            const jobs = [];
            for (const file of jobFiles.slice(offset, offset + limit)) {
                const jobPath = path.join(this.jobsDir, file);
                const job = await fs.readJson(jobPath);
                jobs.push(job);
            }

            // Sort by creation date (newest first)
            jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return {
                jobs,
                total: jobFiles.length,
                limit,
                offset
            };
        } catch (error) {
            logger.error({
                message: 'Failed to list jobs',
                error: error.message
            });
            throw error;
        }
    }

    async cleanupOldJobs(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
        try {
            const files = await fs.readdir(this.jobsDir);
            const now = new Date();
            let cleaned = 0;

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const jobPath = path.join(this.jobsDir, file);
                const job = await fs.readJson(jobPath);
                const jobAge = now - new Date(job.createdAt);

                if (jobAge > maxAge && (job.status === 'completed' || job.status === 'failed')) {
                    await fs.remove(jobPath);
                    
                    // Also cleanup generated files
                    const generatedPath = path.join('./generated', `${job.id}.zip`);
                    if (await fs.pathExists(generatedPath)) {
                        await fs.remove(generatedPath);
                    }
                    
                    cleaned++;
                }
            }

            logger.info({
                message: 'Job cleanup completed',
                cleaned
            });

            return cleaned;
        } catch (error) {
            logger.error({
                message: 'Job cleanup failed',
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = JobManager;
