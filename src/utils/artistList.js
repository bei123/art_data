import { fetchAllListPages, normalizeListPayload } from './paginatedList'

export { normalizeListPayload as normalizeArtistsListPayload }

/** 下拉选项等场景：分页拉取全部艺术家 */
export function fetchAllArtists(api, params = {}) {
  return fetchAllListPages(api, '/artists', {
    params,
    pageSize: 100,
    itemsKeys: ['data', 'artists'],
  })
}

/** 分页拉取全部机构 */
export function fetchAllInstitutions(api, params = {}) {
  return fetchAllListPages(api, '/institutions', {
    params,
    pageSize: 100,
    itemsKeys: ['data'],
  })
}

/** 分页拉取全部实物分类 */
export function fetchAllPhysicalCategories(api, params = {}) {
  return fetchAllListPages(api, '/physical-categories', {
    params,
    pageSize: 100,
    limitKey: 'limit',
    itemsKeys: ['data'],
  })
}

/** 分页拉取全部版权实物 */
export function fetchAllRights(api, params = {}) {
  return fetchAllListPages(api, '/rights', {
    params,
    pageSize: 100,
    limitKey: 'limit',
    itemsKeys: ['data'],
  })
}

/** 管理端数字艺术品列表（接口按页返回纯数组） */
export function fetchAllDigitalArtworksAdmin(api, params = {}) {
  return fetchAllListPages(api, '/digital-artworks/admin', {
    params,
    pageSize: 100,
    itemsKeys: ['data'],
  })
}

/** 分页拉取展览列表 */
export function fetchAllExhibitions(api, params = {}) {
  return fetchAllListPages(api, '/exhibitions', {
    params,
    pageSize: 100,
    itemsKeys: ['data'],
  })
}
