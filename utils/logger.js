const { getRequestId } = require('../middleware/requestContext');

function serializeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = { ...meta };
  if (out.err instanceof Error) {
    out.error_message = out.err.message;
    if (process.env.NODE_ENV !== 'production') {
      out.error_stack = out.err.stack;
    }
    delete out.err;
  }
  return out;
}

/**
 * 单行 JSON 日志，便于采集与按 request_id 检索。
 */
function line(level, msg, meta) {
  const rid =
    meta && Object.prototype.hasOwnProperty.call(meta, 'request_id')
      ? meta.request_id
      : getRequestId();
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(rid ? { request_id: rid } : {}),
    ...serializeMeta(meta),
  };
  let str;
  try {
    str = JSON.stringify(payload);
  } catch {
    str = JSON.stringify({
      ts: payload.ts,
      level: payload.level,
      msg: payload.msg,
      request_id: payload.request_id,
      note: 'log_payload_not_json_serializable',
    });
  }
  if (level === 'error') console.error(str);
  else if (level === 'warn') console.warn(str);
  else console.log(str);
}

module.exports = {
  info: (msg, meta) => line('info', msg, meta),
  warn: (msg, meta) => line('warn', msg, meta),
  error: (msg, meta) => line('error', msg, meta),
};
