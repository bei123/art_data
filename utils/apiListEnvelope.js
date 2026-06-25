/**
 * 公开列表 API 统一响应：{ data, pagination? }
 * pagination: { page, pageSize, total, has_more }
 */

function buildPaginationMeta({ page = 1, pageSize = 20, total = 0 } = {}) {
  const cleanPage = Math.max(1, Number(page) || 1)
  const cleanSize = Math.max(1, Number(pageSize) || 20)
  const totalCount = Math.max(0, Number(total) || 0)
  return {
    page: cleanPage,
    pageSize: cleanSize,
    total: totalCount,
    has_more: cleanPage * cleanSize < totalCount,
  }
}

function buildListEnvelope(data, pagination) {
  const payload = {
    data: Array.isArray(data) ? data : [],
  }
  if (pagination && typeof pagination === 'object') {
    payload.pagination = pagination
  }
  return payload
}

module.exports = {
  buildPaginationMeta,
  buildListEnvelope,
}
