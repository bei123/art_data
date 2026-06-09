const SENSITIVE_KEY = /password|secret|token|authorization|cookie|passwd/i;

function redactLogValue(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactLogValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

module.exports = { redactLogValue };
