/** 生产环境不向客户端返回 err.message / stack */
function shouldExposeErrorDetail() {
  return process.env.NODE_ENV !== 'production'
}

function appendClientErrorDetail(body, err) {
  if (!shouldExposeErrorDetail() || !err?.message) return body
  return { ...body, detail: err.message }
}

module.exports = {
  shouldExposeErrorDetail,
  appendClientErrorDetail,
}
