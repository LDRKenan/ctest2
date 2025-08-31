const { logger } = require('./logger');

const errorHandler = (err, req, res, next) => {
    logger.error({
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        body: req.body,
        params: req.params,
        query: req.query
    });

    // Default error response
    let error = {
        message: 'Internal Server Error',
        status: 500
    };

    // Handle specific error types
    if (err.name === 'ValidationError') {
        error = {
            message: 'Validation Error',
            details: err.message,
            status: 400
        };
    } else if (err.name === 'UnauthorizedError') {
        error = {
            message: 'Unauthorized',
            status: 401
        };
    } else if (err.code === 'LIMIT_FILE_SIZE') {
        error = {
            message: 'File too large',
            status: 413
        };
    } else if (err.message.includes('API key')) {
        error = {
            message: 'AI service configuration error',
            status: 503
        };
    }

    // Don't leak error details in production
    if (process.env.NODE_ENV === 'production') {
        delete error.details;
        delete error.stack;
    } else {
        error.stack = err.stack;
    }

    res.status(error.status).json({
        error: error.message,
        ...(error.details && { details: error.details }),
        ...(error.stack && { stack: error.stack }),
        timestamp: new Date().toISOString()
    });
};

module.exports = errorHandler;
