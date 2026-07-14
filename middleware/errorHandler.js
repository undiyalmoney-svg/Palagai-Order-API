function notFoundHandler(req, res, next) {
  res.status(404).json({
    status: 'error',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || err.response?.status || 500;
  const kiteBody = err.response?.data;
  const message =
    (typeof kiteBody === 'object' && kiteBody?.message) ||
    err.message ||
    'Internal server error';

  console.error('[error]', req.method, req.originalUrl, status, message);
  if (err.stack && status >= 500) {
    console.error(err.stack);
  }

  if (kiteBody && typeof kiteBody === 'object') {
    res.status(status).json(kiteBody);
    return;
  }

  res.status(status).json({
    status: 'error',
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };
