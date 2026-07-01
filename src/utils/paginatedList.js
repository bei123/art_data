/**
 * 统一解析列表接口响应（纯数组 / { data, pagination } / { artists } 等）
 */
export function normalizeListPayload(response, options = {}) {
  const itemsKeys = options.itemsKeys ?? ['data', 'items', 'artists']

  if (Array.isArray(response)) {
    return { items: response, pagination: null }
  }

  for (const key of itemsKeys) {
    if (response?.[key] && Array.isArray(response[key])) {
      return { items: response[key], pagination: response.pagination ?? null }
    }
  }

  return { items: [], pagination: null }
}

export function hasMoreListPages({ pagination, page, pageSize, itemsLength }) {
  if (pagination?.has_more === true) return true
  if (pagination?.has_more === false) return false

  const totalPages = pagination?.totalPages ?? pagination?.total_pages
  if (Number.isFinite(totalPages)) return page < totalPages

  const total = Number(pagination?.total)
  if (Number.isFinite(total) && total >= 0) return page * pageSize < total

  return itemsLength >= pageSize
}

/**
 * 下拉选项、无分页 UI 的管理页：自动翻页拉全量
 */
export async function fetchAllListPages(api, url, options = {}) {
  const {
    params = {},
    pageSize = 100,
    pageKey = 'page',
    pageSizeKey = 'pageSize',
    limitKey = null,
    itemsKeys = ['data', 'items', 'artists'],
    maxPages = 200,
  } = options

  const sizeKey = limitKey || pageSizeKey
  let page = 1
  const all = []

  for (;;) {
    const query = { ...params, [pageKey]: page, [sizeKey]: pageSize }
    const response = await api.get(url, { params: query })
    const { items, pagination } = normalizeListPayload(response, { itemsKeys })
    all.push(...items)

    const hasMore = hasMoreListPages({ pagination, page, pageSize, itemsLength: items.length })
    if (!hasMore || items.length === 0) break
    if (page >= maxPages) break
    page += 1
  }

  return all
}
