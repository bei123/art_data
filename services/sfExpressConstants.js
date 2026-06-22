/**
 * 顺丰开放平台附录常量
 * @see 路由信息操作码 https://open.sf-express.com/developSupport/734349?activeIndex=589678
 * @see 快件产品类别码 https://open.sf-express.com/developSupport/734349?activeIndex=324604
 */

const {
  ACTION_TYPE,
  SF_ROUTE_OPCODE_ROWS,
  getSfRouteOpcodeCatalog,
  getSfRouteOpcodeMeta,
  getSfRouteOpcodeName,
  resolveSfRouteOpcode,
  mapSfOpcodeToActionType,
} = require('./sfExpressRouteOpcodes')
const { SF_EXPRESS_PRODUCT_CATALOG } = require('./sfExpressProductData')
const {
  SF_ERROR_CODE_ROWS,
  SF_API_RESULT_CODE_ROWS,
  getSfErrorCodeCatalog,
  getSfApiResultCodeCatalog,
  getSfErrorMeta,
  getSfApiResultMeta,
  formatSfErrorMessage,
  formatSfApiResultMessage,
  formatSfBizErrorMessage,
} = require('./sfExpressErrorCodes')

/** 发货页默认展示的产品编码（可在 .env 用 SF_EXPRESS_TYPES 覆盖） */
const DEFAULT_SF_EXPRESS_TYPE_IDS = [1, 2, 6, 231, 247, 255, 263, 283, 293]

function catalogToServiceTypes(catalog, expressTypeIds) {
  const idSet = expressTypeIds ? new Set(expressTypeIds.map((id) => Number(id))) : null
  return catalog
    .filter((item) => !idSet || idSet.has(item.expressTypeId))
    .map((item) => ({
      service_type: item.expressTypeId,
      service_name: item.name,
      timeliness: item.timeliness,
    }))
}

function getDefaultSfServiceTypes() {
  return catalogToServiceTypes(SF_EXPRESS_PRODUCT_CATALOG, DEFAULT_SF_EXPRESS_TYPE_IDS)
}

function getAllSfServiceTypes() {
  return catalogToServiceTypes(SF_EXPRESS_PRODUCT_CATALOG)
}

function parseSfServiceTypesFromEnv(raw) {
  const trimmed = raw != null ? String(raw).trim() : ''
  if (!trimmed) return getDefaultSfServiceTypes()
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed) || !parsed.length) return getDefaultSfServiceTypes()
    return parsed
      .map((item) => {
        const expressTypeId = Number(item.service_type ?? item.expressTypeId ?? item.express_type_id)
        const name = String(item.service_name ?? item.name ?? '').trim()
        if (Number.isNaN(expressTypeId) || !name) return null
        const fromCatalog = SF_EXPRESS_PRODUCT_CATALOG.find((p) => p.expressTypeId === expressTypeId)
        return {
          service_type: expressTypeId,
          service_name: name,
          timeliness: item.timeliness || fromCatalog?.timeliness,
        }
      })
      .filter(Boolean)
  } catch {
    return getDefaultSfServiceTypes()
  }
}

function getSfExpressProductMeta(expressTypeId) {
  const id = Number(expressTypeId)
  if (Number.isNaN(id)) return null
  return SF_EXPRESS_PRODUCT_CATALOG.find((item) => item.expressTypeId === id) || null
}

function getSfExpressProductName(expressTypeId) {
  return getSfExpressProductMeta(expressTypeId)?.name || ''
}

module.exports = {
  ACTION_TYPE,
  SF_ROUTE_OPCODE_ROWS,
  getSfRouteOpcodeCatalog,
  resolveSfRouteOpcode,
  SF_EXPRESS_PRODUCT_CATALOG,
  DEFAULT_SF_EXPRESS_TYPE_IDS,
  getSfRouteOpcodeMeta,
  getSfRouteOpcodeName,
  mapSfOpcodeToActionType,
  getDefaultSfServiceTypes,
  getAllSfServiceTypes,
  parseSfServiceTypesFromEnv,
  getSfExpressProductMeta,
  getSfExpressProductName,
  SF_ERROR_CODE_ROWS,
  SF_API_RESULT_CODE_ROWS,
  getSfErrorCodeCatalog,
  getSfApiResultCodeCatalog,
  getSfErrorMeta,
  getSfApiResultMeta,
  formatSfErrorMessage,
  formatSfApiResultMessage,
  formatSfBizErrorMessage,
}
