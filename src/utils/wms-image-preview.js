import { API_BASE_URL } from '../config'

/**
 * 通过管理端代理拉取 WMS 仓库图（Authorization 头，避免 img?token= 鉴权失败）
 * @param {number|string} artworkId
 * @param {number} index
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>} blob object URL，用完后须 URL.revokeObjectURL
 */
export async function fetchWmsImageObjectUrl(artworkId, index = 0, options = {}) {
  const id = Number(artworkId)
  if (!id || id <= 0) throw new Error('无效的作品ID')

  const token = localStorage.getItem('token') || ''
  const url = `${API_BASE_URL}/api/original-artworks/${id}/admin/wms-image?index=${index}`

  const res = await fetch(url, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    signal: options.signal,
  })

  if (!res.ok) {
    let message = `仓库图加载失败 (${res.status})`
    try {
      const errBody = await res.json()
      if (errBody?.error) message = errBody.error
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(message)
  }

  const blob = await res.blob()
  if (!blob.size) throw new Error('仓库图为空')
  if (blob.type && blob.type.includes('json')) {
    throw new Error('仓库图加载失败')
  }

  return URL.createObjectURL(blob)
}

export function revokeWmsImageObjectUrl(objectUrl) {
  if (objectUrl && String(objectUrl).startsWith('blob:')) {
    URL.revokeObjectURL(objectUrl)
  }
}
