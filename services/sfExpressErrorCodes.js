const { SF_ERROR_CODE_ROWS } = require('./sfExpressErrorCodeData')
const { SF_API_RESULT_CODE_ROWS } = require('./sfExpressApiResultCodeData')

const API_RESULT_OK = 'A1000'

function normalizeCode(code) {
  if (code == null) return ''
  return String(code).trim()
}

function buildCatalog(rows, extraRows, defaultNamePrefix) {
  const catalog = {}
  for (const row of rows) {
    const code = normalizeCode(row.code)
    if (!code) continue
    catalog[code] = {
      code,
      nameZh: row.nameZh || '',
      nameEn: row.nameEn || '',
      suggestion: row.suggestion || '',
    }
  }
  if (Array.isArray(extraRows)) {
    for (const row of extraRows) {
      const code = normalizeCode(row.code)
      if (!code) continue
      catalog[code] = {
        code,
        nameZh: String(row.nameZh || row.name || `${defaultNamePrefix}${code}`).trim(),
        nameEn: row.nameEn != null ? String(row.nameEn).trim() : '',
        suggestion: row.suggestion != null ? String(row.suggestion).trim() : '',
      }
    }
  }
  return catalog
}

function parseJsonArrayFromEnv(key) {
  const raw = (process.env[key] || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let bizCatalogCache = null
let apiCatalogCache = null

function getSfErrorCodeCatalog() {
  if (!bizCatalogCache) {
    bizCatalogCache = buildCatalog(
      SF_ERROR_CODE_ROWS,
      parseJsonArrayFromEnv('SF_ERROR_CODE_EXTRA'),
      '业务错误码 ',
    )
  }
  return bizCatalogCache
}

function getSfApiResultCodeCatalog() {
  if (!apiCatalogCache) {
    apiCatalogCache = buildCatalog(
      SF_API_RESULT_CODE_ROWS,
      parseJsonArrayFromEnv('SF_API_RESULT_CODE_EXTRA'),
      '平台返回码 ',
    )
  }
  return apiCatalogCache
}

function resetSfErrorCodeCatalogCache() {
  bizCatalogCache = null
  apiCatalogCache = null
}

function getSfErrorMeta(errorCode) {
  const code = normalizeCode(errorCode)
  if (!code) return null
  return getSfErrorCodeCatalog()[code] || null
}

function getSfApiResultMeta(apiResultCode) {
  const code = normalizeCode(apiResultCode)
  if (!code) return null
  return getSfApiResultCodeCatalog()[code] || null
}

function formatCatalogMessage(meta, remoteMsg, fallbackLabel, code) {
  if (meta) {
    const title = meta.nameZh || remoteMsg || `${fallbackLabel}（${code}）`
    const message = meta.suggestion ? `${title}：${meta.suggestion}` : title
    return `${message} [${code}]`
  }
  if (remoteMsg) return `${remoteMsg} [${code}]`
  return code ? `${fallbackLabel}（${code}）` : fallbackLabel
}

function toSfErrorPayload(meta, layer, code) {
  if (!code) return undefined
  if (meta) {
    return {
      layer,
      code: meta.code,
      name_zh: meta.nameZh,
      name_en: meta.nameEn || undefined,
      suggestion: meta.suggestion || undefined,
    }
  }
  return { layer, code: normalizeCode(code) }
}

function formatSfApiResultMessage({ apiResultCode, apiErrorMsg }) {
  const code = normalizeCode(apiResultCode)
  const meta = code ? getSfApiResultMeta(code) : null
  const remoteMsg = apiErrorMsg != null ? String(apiErrorMsg).trim() : ''
  return formatCatalogMessage(meta, remoteMsg, '顺丰平台错误', code)
}

function formatSfBizErrorMessage({ errorCode, errorMsg, apiErrorMsg }) {
  const code = normalizeCode(errorCode)
  const meta = code ? getSfErrorMeta(code) : null
  const remoteMsg = errorMsg != null && String(errorMsg).trim() !== ''
    ? String(errorMsg).trim()
    : (apiErrorMsg != null ? String(apiErrorMsg).trim() : '')
  return formatCatalogMessage(meta, remoteMsg, '顺丰业务错误', code)
}

/** @deprecated 使用 formatSfBizErrorMessage / formatSfApiResultMessage */
function formatSfErrorMessage({
  errorCode,
  errorMsg,
  apiErrorMsg,
  apiResultCode,
}) {
  const apiCode = normalizeCode(apiResultCode)
  if (apiCode && apiCode !== API_RESULT_OK) {
    return formatSfApiResultMessage({ apiResultCode: apiCode, apiErrorMsg: apiErrorMsg || errorMsg })
  }
  return formatSfBizErrorMessage({ errorCode, errorMsg, apiErrorMsg })
}

function enrichSfErrorResult(result) {
  if (!result || result.ok) return result

  const apiResultCode = normalizeCode(result.apiResultCode)
  const isApiLayerFailure = apiResultCode && apiResultCode !== API_RESULT_OK

  if (isApiLayerFailure) {
    const meta = getSfApiResultMeta(apiResultCode)
    return {
      ...result,
      error: formatSfApiResultMessage({
        apiResultCode,
        apiErrorMsg: result.apiErrorMsg ?? result.error,
      }),
      sf_error: toSfErrorPayload(meta, 'api', apiResultCode),
    }
  }

  const errorCode = result.errorCode ?? result.biz?.errorCode
  const meta = getSfErrorMeta(errorCode)
  return {
    ...result,
    error: formatSfBizErrorMessage({
      errorCode,
      errorMsg: result.biz?.errorMsg ?? result.error,
      apiErrorMsg: result.apiErrorMsg,
    }),
    sf_error: toSfErrorPayload(meta, 'biz', errorCode),
  }
}

module.exports = {
  SF_ERROR_CODE_ROWS,
  SF_API_RESULT_CODE_ROWS,
  API_RESULT_OK,
  getSfErrorCodeCatalog,
  getSfApiResultCodeCatalog,
  resetSfErrorCodeCatalogCache,
  getSfErrorMeta,
  getSfApiResultMeta,
  formatSfErrorMessage,
  formatSfApiResultMessage,
  formatSfBizErrorMessage,
  enrichSfErrorResult,
}
