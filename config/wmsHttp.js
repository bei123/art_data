/**
 * WMS 直连 HTTP（非 REBUILD /gw/api 签名网关）。在 .env 中配置基址与鉴权。
 *
 * 登录失败「用户名或密码错误」常见原因：
 * - .env 里密码含 # 或行首有空格，未用双引号导致被截断或读错
 * - 与浏览器不一致：WMS_HTTP_USER 须与登录框完全一致（如 zhibei@2000gallery.art，勿多空格）
 * - Referer 须为站点根 /（客户端已与 DevTools 对齐）；WMS_HTTP_BASE_URL=https://wms.2000gallery.art
 * - 密码含特殊字符：可用 WMS_HTTP_PASSWORD_B64（UTF-8 明文做 base64，无换行）
 * - REBUILD 约定：URL 中 passwd 为占位 ******，真实密码在 POST body；客户端须与之一致（见 wmsHttpClient.wmsUserLogin）
 * - 返回 VCODE：站点开启图形验证码时，可设 WMS_HTTP_VCODE（与图一致），或 WMS_HTTP_COOKIE（从已打开 /user/login 的浏览器复制整段 Cookie，须含 RBSESSION）
 */
require('dotenv').config()

function trimSlash(s) {
  return String(s || '').replace(/\/+$/, '')
}

const WMS_HTTP_BASE_URL = trimSlash(process.env.WMS_HTTP_BASE_URL || '')
const WMS_HTTP_BEARER_TOKEN = String(process.env.WMS_HTTP_BEARER_TOKEN || '').trim()
/** 与 Web 登录框一致（多为邮箱或登录名） */
const WMS_HTTP_USER = String(process.env.WMS_HTTP_USER || '').trim()

/**
 * 登录用密码：优先 WMS_HTTP_PASSWORD_B64（base64），否则 WMS_HTTP_PASSWORD 原样（不 trim，避免误伤）。
 * 与 REBUILD 网页一致：该明文由 wmsUserLogin 写入 POST body，而非 URL 查询串。
 */
function getWmsHttpPasswordForLogin() {
  const b64 = String(process.env.WMS_HTTP_PASSWORD_B64 || '').trim()
  if (b64) {
    try {
      return Buffer.from(b64, 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return String(process.env.WMS_HTTP_PASSWORD ?? '')
}

/** 可选：WMS 同步新建原作时的占位图 URL（须通过 validatePublicImageUrl） */
const WMS_SYNC_PLACEHOLDER_IMAGE = String(process.env.WMS_SYNC_PLACEHOLDER_IMAGE || '').trim()
/** REBUILD 附件 CDN 根（浏览器拉图域名，如 http://qn.2000gallery.art） */
const WMS_IMAGE_CDN_ORIGIN = trimSlash(process.env.WMS_IMAGE_CDN_ORIGIN || 'http://qn.2000gallery.art')
/**
 * 七牛私有桶 AK/SK（与 WMS 仓库图同一桶时可自签 imageView2，无需改 WMS 302 URL）
 * QINIU_ACCESS_KEY / QINIU_SECRET_KEY — 必填才启用自签
 * QINIU_PRIVATE_URL_EXPIRES_SEC — 签名有效期秒数，默认 3600
 */
/**
 * 采用仓库图时七牛 imageView2 参数。默认空字符串 = 拉取桶内原图（不经 imageView2 二次压缩）。
 * 可设为 imageView2/2/w/0/interlace/1/q/100；设为 original/none/raw 同空字符串。
 */
const WMS_IMAGE_VIEW_PARAMS = String(process.env.WMS_IMAGE_VIEW_PARAMS ?? '').trim()
/** 管理端预览代理：缩略图，减轻带宽与内存 */
const WMS_IMAGE_PREVIEW_VIEW_PARAMS = String(
  process.env.WMS_IMAGE_PREVIEW_VIEW_PARAMS || 'imageView2/2/w/640/interlace/1/q/90'
).trim()
/** 采用仓库图转 WebP 的起始质量（1–100），不足 5MB 时再逐步降低 */
const WMS_APPLY_WEBP_QUALITY = Math.min(
  100,
  Math.max(70, parseInt(process.env.WMS_APPLY_WEBP_QUALITY || '92', 10) || 92)
)
/** 可选：JSON 字符串，合并进请求头，如 {"X-Api-Key":"xxx"} */
const WMS_HTTP_EXTRA_HEADERS_JSON = String(process.env.WMS_HTTP_EXTRA_HEADERS_JSON || '').trim()
/** 可选：登录 POST 使用的 Cookie（如从 DevTools 复制，须含 RBSESSION）；若设置则跳过自动 GET /user/login 预热 */
const WMS_HTTP_COOKIE = String(process.env.WMS_HTTP_COOKIE || '').trim()
/** 可选：图形验证码字符（与 WMS 登录页一致）；开启验证码且未用 Cookie 兜底时填写 */
const WMS_HTTP_VCODE = String(process.env.WMS_HTTP_VCODE || '').trim()
/** 可选；默认 Chrome UA，与浏览器行为接近 */
const WMS_HTTP_USER_AGENT =
  String(process.env.WMS_HTTP_USER_AGENT || '').trim() ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 定期同步（见 services/wmsProductSyncService.startWmsProductSyncSchedule）
 * WMS_SYNC_SCHEDULE_ENABLED — 默认随 WMS_HTTP_BASE_URL 是否配置而启用；设为 false 关闭
 * WMS_SYNC_INTERVAL_MS — 默认 21600000（6 小时）
 * WMS_SYNC_START_DELAY_MS — 进程启动后首次同步延迟，默认 30000
 * WMS_SYNC_RUN_ON_START — 是否在启动后执行一次，默认 true
 * WMS_SYNC_MAX_PAGES / WMS_SYNC_PAGE_SIZE / WMS_SYNC_DETAIL_CONCURRENCY — 定时任务分页参数
 */

function isWmsHttpConfigured() {
  return Boolean(WMS_HTTP_BASE_URL)
}

/** 是否具备 WMS 登录所需三项（基址、用户名、密码） */
function isWmsLoginConfigured() {
  return Boolean(WMS_HTTP_BASE_URL && WMS_HTTP_USER && getWmsHttpPasswordForLogin())
}

function parseExtraHeaders() {
  if (!WMS_HTTP_EXTRA_HEADERS_JSON) return {}
  try {
    const o = JSON.parse(WMS_HTTP_EXTRA_HEADERS_JSON)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

module.exports = {
  WMS_HTTP_BASE_URL,
  WMS_HTTP_BEARER_TOKEN,
  WMS_HTTP_USER,
  getWmsHttpPasswordForLogin,
  WMS_SYNC_PLACEHOLDER_IMAGE,
  WMS_IMAGE_CDN_ORIGIN,
  WMS_IMAGE_VIEW_PARAMS,
  WMS_IMAGE_PREVIEW_VIEW_PARAMS,
  WMS_APPLY_WEBP_QUALITY,
  WMS_HTTP_EXTRA_HEADERS_JSON,
  WMS_HTTP_COOKIE,
  WMS_HTTP_VCODE,
  WMS_HTTP_USER_AGENT,
  isWmsHttpConfigured,
  isWmsLoginConfigured,
  parseExtraHeaders,
}
