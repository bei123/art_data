/**
 * Safari / iOS WebKit（含 macOS 上的 Safari、微信内置浏览器等）
 * 对跨域 img、CORP、blob 的组合更敏感，仓库图优先走 fetch+blob。
 */
export function isSafariWebKit() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isAppleWebKit = /AppleWebKit/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua)
  return isAppleWebKit
}
