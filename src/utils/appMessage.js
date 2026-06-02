import { ElMessage } from 'element-plus'

/** 后台布局（侧栏 + 顶栏）下，避免提示被顶栏遮挡 */
export const LAYOUT_MESSAGE_OFFSET = 72

/** 登录页等全屏页面 */
export const PAGE_MESSAGE_OFFSET = 20

function normalizeOptions(messageOrOptions, offset) {
  if (typeof messageOrOptions === 'string') {
    return { message: messageOrOptions, offset }
  }
  return { ...messageOrOptions, offset: messageOrOptions.offset ?? offset }
}

export function showLayoutSuccess(messageOrOptions) {
  return ElMessage.success(normalizeOptions(messageOrOptions, LAYOUT_MESSAGE_OFFSET))
}

export function showPageSuccess(messageOrOptions) {
  return ElMessage.success(normalizeOptions(messageOrOptions, PAGE_MESSAGE_OFFSET))
}

export function showPageWarning(messageOrOptions) {
  return ElMessage.warning(normalizeOptions(messageOrOptions, PAGE_MESSAGE_OFFSET))
}
