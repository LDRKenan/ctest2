const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs-extra');

// Load environment variables
dotenv.config();

// Import routes
const generateRoutes = require('./routes/generate');
const analyzeRoutes = require('./routes/analyze');
const statusRoutes = require('./routes/status');

// Import middleware
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(logger);
app.use(rateLimiter);

// Serve static files
app.use(express.static('public'));

// Ensure required directories exist
const requiredDirs = ['./uploads', './generated', './logs'];
requiredDirs.forEach(dir => {
    fs.ensureDirSync(dir);
});

// Routes
app.use('/api/generate', generateRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/status', statusRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: require('../package.json').version
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Codemia AI',
        description: 'AI-powered multi-platform code generation system',
        version: require('../package.json').version,
        endpoints: {
            generate: '/api/generate',
            analyze: '/api/analyze',
            status: '/api/status/:jobId',
            health: '/health'
        }
    });
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Codemia AI server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 API docs: http://localhost:${PORT}/`);
});

module.exports = app;
