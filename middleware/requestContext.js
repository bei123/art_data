const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const MAX_HEADER_LEN = 128;

/**
 * 为每个请求设置 requestId（支持客户端传入 X-Request-Id），并写入 AsyncLocalStorage，
 * 便于在 db 等无 req 的代码中打关联日志。
 */
function requestContextMiddleware(req, res, next) {
  const raw = req.headers['x-request-id'];
  const fromClient =
    raw != null && String(raw).trim() !== ''
      ? String(raw).trim().slice(0, MAX_HEADER_LEN)
      : null;
  const requestId = fromClient || crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  storage.run({ requestId }, next);
}

function getRequestId() {
  const store = storage.getStore();
  return store && store.requestId ? store.requestId : undefined;
}

module.exports = {
  requestContextMiddleware,
  getRequestId,
  storage,
};
