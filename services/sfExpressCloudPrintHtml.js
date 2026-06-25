/**
 * 顺丰云打印 HTML 面单（COM_RECE_CLOUD_PRINT_HTML）
 * @see https://open.sf-express.com/Api/ApiDetails?level3=xxx
 */
const axios = require('axios')
const logger = require('../utils/logger')
const { callSfService, getSfConfig, buildRequestId } = require('./sfExpressClient')

const SERVICE_CODE_CLOUD_PRINT_HTML = 'COM_RECE_CLOUD_PRINT_HTML'
const CLOUD_PRINT_VERSION = '2.0'
const MAX_DOCUMENTS_PER_REQUEST = 20

function resolveCloudPrintTemplateCode(partnerId, rawOverride) {
  const pid = String(partnerId || '').trim()
  let raw = String(
    rawOverride || process.env.SF_CLOUD_PRINT_TEMPLATE_CODE || 'fm_76130_standard_{partnerId}',
  ).trim()

  if (pid && (raw.includes('{partnerId}') || raw.includes('{{clientcode}}')) && raw.includes(pid)) {
    raw = raw
      .replace(/_?\{partnerId\}/gi, '')
      .replace(/_?\{\{clientcode\}\}/gi, '')
  }

  let resolved = raw
    .replace(/\{\{clientcode\}\}/gi, pid)
    .replace(/\{partnerId\}/gi, pid)

  if (pid) {
    const doubleSuffix = `_${pid}_${pid}`
    while (resolved.endsWith(doubleSuffix)) {
      resolved = resolved.slice(0, -(`_${pid}`.length))
    }
  }

  return resolved
}

function resolveOptionalCustomTemplateCode(standardTemplateCode, customOverride) {
  const custom = String(
    customOverride || process.env.SF_CLOUD_PRINT_CUSTOM_TEMPLATE_CODE || '',
  ).trim()
  if (!custom) return undefined

  const standard = String(standardTemplateCode || '').trim()
  if (custom === standard) {
    logger.warn('SF_CLOUD_PRINT_CUSTOM_TEMPLATE_CODE equals templateCode, ignored', { custom })
    return undefined
  }

  if (!/_custom_/i.test(custom)) {
    logger.warn('SF_CLOUD_PRINT_CUSTOM_TEMPLATE_CODE is not a custom template, ignored', { custom })
    return undefined
  }

  return custom
}

function resolveCloudPrintCheckFields(options = {}) {
  const checkType = String(
    options.waybillNoCheckType
    || process.env.SF_CLOUD_PRINT_WAYBILL_CHECK_TYPE
    || '',
  ).trim()
  const checkValue = String(
    options.waybillNoCheckValue
    || process.env.SF_CLOUD_PRINT_WAYBILL_CHECK_VALUE
    || '',
  ).trim()
  if (!checkType || !checkValue) return {}
  return {
    waybillNoCheckType: checkType,
    waybillNoCheckValue: checkValue.slice(-6),
  }
}

function normalizeWaybillEntry(item) {
  if (!item || typeof item !== 'object') return null
  const waybillNo = String(item.waybillNo ?? item.waybill_no ?? '').trim()
  if (!waybillNo) return null
  const waybillType = String(item.waybillType ?? item.waybill_type ?? '1')
  return { waybillType, waybillNo }
}

function buildCloudPrintDocuments(waybillNoInfoList, fallbackWaybillNo, checkFields = {}) {
  const normalized = (Array.isArray(waybillNoInfoList) ? waybillNoInfoList : [])
    .map(normalizeWaybillEntry)
    .filter(Boolean)

  const fallback = String(fallbackWaybillNo || '').trim()
  if (!normalized.length && fallback) {
    return [{ masterWaybillNo: fallback, ...checkFields }]
  }
  if (!normalized.length) return []

  const mother = normalized.find((item) => item.waybillType === '1') || normalized[0]
  const branches = normalized.filter(
    (item) => item.waybillNo !== mother.waybillNo && item.waybillType !== '1',
  )

  if (!branches.length) {
    return [{ masterWaybillNo: mother.waybillNo, ...checkFields }]
  }

  const sum = String(normalized.length)
  const documents = [
    { masterWaybillNo: mother.waybillNo, seq: '1', sum, ...checkFields },
  ]

  branches.forEach((branch, index) => {
    documents.push({
      masterWaybillNo: mother.waybillNo,
      branchWaybillNo: branch.waybillNo,
      seq: String(index + 2),
      sum,
      ...checkFields,
    })
  })

  return documents.slice(0, MAX_DOCUMENTS_PER_REQUEST)
}

function buildCloudPrintPayload({
  partnerId,
  waybillNoInfoList,
  fallbackWaybillNo,
  templateCode: templateCodeOption,
  customTemplateCode,
  fileType,
  extJson,
  waybillNoCheckType,
  waybillNoCheckValue,
} = {}) {
  const cfg = getSfConfig()
  const pid = partnerId || cfg.partnerId
  const checkFields = resolveCloudPrintCheckFields({ waybillNoCheckType, waybillNoCheckValue })
  const documents = buildCloudPrintDocuments(waybillNoInfoList, fallbackWaybillNo, checkFields)

  if (!documents.length) {
    return { ok: false, error: '缺少可打印的运单号' }
  }

  const templateCode = templateCodeOption || resolveCloudPrintTemplateCode(pid)
  const payload = {
    templateCode,
    version: CLOUD_PRINT_VERSION,
    fileType: fileType || 'html',
    documents,
  }

  const customCode = resolveOptionalCustomTemplateCode(templateCode, customTemplateCode)
  if (customCode) payload.customTemplateCode = customCode

  if (extJson && typeof extJson === 'object') {
    payload.extJson = extJson
  } else {
    const extRaw = String(process.env.SF_CLOUD_PRINT_EXT_JSON || '').trim()
    if (extRaw) {
      try {
        payload.extJson = JSON.parse(extRaw)
      } catch {
        return { ok: false, error: 'SF_CLOUD_PRINT_EXT_JSON 不是合法 JSON' }
      }
    }
  }

  return { ok: true, payload, documents }
}

function assessCloudPrintResponse(biz) {
  if (!biz || typeof biz !== 'object') {
    return { ok: false, error: '顺丰未返回云打印数据' }
  }
  if (biz.success === false) {
    return {
      ok: false,
      error: biz.errorMessage || biz.errorMsg || '云打印面单失败',
      errorCode: biz.errorCode,
    }
  }

  const obj = biz.obj && typeof biz.obj === 'object' ? biz.obj : biz
  const files = Array.isArray(obj.files) ? obj.files : []
  if (!files.length) {
    return { ok: false, error: '顺丰未返回面单 HTML 文件' }
  }

  const sorted = [...files].sort((a, b) => {
    const seqA = Number(a.seqNo) || 0
    const seqB = Number(b.seqNo) || 0
    return seqA - seqB
  })

  return {
    ok: true,
    files: sorted.map((file) => ({
      url: file.url != null ? String(file.url) : '',
      token: file.token != null ? String(file.token) : '',
      waybill_no: file.waybillNo != null ? String(file.waybillNo) : '',
      seq_no: Number(file.seqNo) || 0,
      area_no: Number(file.areaNo) || 0,
      page_no: Number(file.pageNo) || 0,
    })),
    template_code: obj.templateCode,
    client_code: obj.clientCode,
    file_type: obj.fileType || 'html',
    request_id: biz.requestId,
  }
}

async function requestCloudPrintHtml(payload) {
  const requestID = buildRequestId()
  const result = await callSfService(SERVICE_CODE_CLOUD_PRINT_HTML, payload, { requestID })
  if (!result.ok) return result

  const assessed = assessCloudPrintResponse(result.biz)
  if (!assessed.ok) {
    return {
      ok: false,
      error: assessed.error,
      errorCode: assessed.errorCode,
      biz: result.biz,
    }
  }

  return {
    ok: true,
    requestID,
    ...assessed,
    biz: result.biz,
  }
}

async function downloadCloudPrintHtmlFile({ url, token }) {
  const fileUrl = String(url || '').trim()
  if (!fileUrl) {
    return { ok: false, error: '缺少面单文件下载地址' }
  }

  try {
    const headers = {}
    const authToken = String(token || '').trim()
    if (authToken) headers['X-Auth-token'] = authToken

    const { data, status } = await axios.get(fileUrl, {
      timeout: 25000,
      headers,
      responseType: 'text',
      maxRedirects: 5,
      validateStatus: (code) => code >= 200 && code < 400,
    })

    const html = typeof data === 'string' ? data : String(data || '')
    if (!html.trim()) {
      return { ok: false, error: '面单 HTML 下载为空', http_status: status }
    }

    return { ok: true, html, http_status: status }
  } catch (err) {
    logger.warn('downloadCloudPrintHtmlFile failed', {
      url: fileUrl.slice(0, 120),
      err: err?.message || String(err),
      status: err?.response?.status,
    })
    return {
      ok: false,
      error: '面单 HTML 下载失败',
      detail: err?.message || String(err),
      http_status: err?.response?.status,
    }
  }
}

function mergeCloudPrintHtmlPages(htmlParts) {
  const parts = (htmlParts || []).map((item) => String(item || '').trim()).filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0]

  const bodies = parts.map((html) => {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    return bodyMatch ? bodyMatch[1] : html
  })

  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>顺丰面单</title>',
    '<style>@media print{ .sf-waybill-page{ page-break-after:always } .sf-waybill-page:last-child{ page-break-after:auto } }</style>',
    '</head><body>',
    ...bodies.map((body, index) => `<div class="sf-waybill-page">${body}</div>`),
    '</body></html>',
  ].join('')
}

async function fetchCloudPrintWaybillHtml(options = {}) {
  const built = buildCloudPrintPayload(options)
  if (!built.ok) return built

  const printResult = await requestCloudPrintHtml(built.payload)
  if (!printResult.ok) return printResult

  const downloads = []
  for (const file of printResult.files) {
    const downloaded = await downloadCloudPrintHtmlFile(file)
    if (!downloaded.ok) {
      return {
        ok: false,
        error: downloaded.error || '面单 HTML 下载失败',
        print_files: printResult.files,
        detail: downloaded.detail,
      }
    }
    downloads.push({
      ...file,
      html: downloaded.html,
    })
  }

  const html = mergeCloudPrintHtmlPages(downloads.map((item) => item.html))

  return {
    ok: true,
    html,
    print_files: downloads.map(({ html: _html, ...meta }) => meta),
    template_code: printResult.template_code,
    client_code: printResult.client_code,
    file_type: printResult.file_type,
    request_id: printResult.request_id,
    document_count: built.documents.length,
  }
}

module.exports = {
  SERVICE_CODE_CLOUD_PRINT_HTML,
  CLOUD_PRINT_VERSION,
  MAX_DOCUMENTS_PER_REQUEST,
  resolveCloudPrintTemplateCode,
  resolveOptionalCustomTemplateCode,
  resolveCloudPrintCheckFields,
  buildCloudPrintDocuments,
  buildCloudPrintPayload,
  assessCloudPrintResponse,
  requestCloudPrintHtml,
  downloadCloudPrintHtmlFile,
  mergeCloudPrintHtmlPages,
  fetchCloudPrintWaybillHtml,
}
