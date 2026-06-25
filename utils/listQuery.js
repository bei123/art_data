const DEFAULT_LIST_PAGE_SIZE = 100
const MAX_LIST_PAGE_SIZE = 100

function parseListPageParams(query, options = {}) {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_LIST_PAGE_SIZE
  const maxPageSize = options.maxPageSize ?? MAX_LIST_PAGE_SIZE
  const explicit = query?.page != null || query?.pageSize != null
  const page = Math.max(1, parseInt(query?.page, 10) || 1)
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, parseInt(query?.pageSize, 10) || defaultPageSize)
  )
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    explicit,
  }
}

function buildSimplePagination({ page, pageSize, total }) {
  const totalCount = Math.max(0, Number(total) || 0)
  return {
    page,
    pageSize,
    total: totalCount,
    has_more: page * pageSize < totalCount,
  }
}

module.exports = {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_PAGE_SIZE,
  parseListPageParams,
  buildSimplePagination,
}
