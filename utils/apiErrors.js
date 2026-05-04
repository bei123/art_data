class ApiError extends Error {
  /**
   * @param {string} message 对用户可读说明
   * @param {{ statusCode?: number, code?: string }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = opts.statusCode ?? 400;
    this.code = opts.code ?? 'BAD_REQUEST';
  }
}

function requestIdFromReq(req) {
  return req && req.requestId ? req.requestId : null;
}

/**
 * 统一 API 错误 JSON：error、code、request_id；开发环境可附带 detail。
 */
function sendErrorResponse(res, err, req) {
  const request_id = requestIdFromReq(req);
  if (request_id && !res.getHeader('X-Request-Id')) {
    res.setHeader('X-Request-Id', request_id);
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      request_id,
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: '文件大小超过限制',
      code: 'LIMIT_FILE_SIZE',
      request_id,
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: '不支持的文件类型',
      code: 'LIMIT_UNEXPECTED_FILE',
      request_id,
    });
  }

  if (err.message && err.message.includes('文件')) {
    return res.status(400).json({
      error: err.message,
      code: 'FILE_ERROR',
      request_id,
    });
  }

  if (err.message === 'CORS not allowed') {
    return res.status(403).json({
      error: 'CORS策略不允许此来源',
      code: 'CORS_DENIED',
      request_id,
    });
  }

  const body = {
    error: '服务器内部错误',
    code: 'INTERNAL_ERROR',
    request_id,
  };
  if (process.env.NODE_ENV !== 'production') {
    body.detail = err.message;
    if (err.stack) body.stack = err.stack;
  }
  return res.status(500).json(body);
}

module.exports = {
  ApiError,
  sendErrorResponse,
  requestIdFromReq,
};
