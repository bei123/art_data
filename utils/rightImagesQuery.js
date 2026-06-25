const db = require('../db')

/** 订单项列表取权益首图（避免 JOIN right_images 行放大） */
const FIRST_RIGHT_IMAGE_SUBQUERY_SQL =
  `(SELECT ri.image_url FROM right_images ri WHERE ri.right_id = oi.right_id ORDER BY ri.id ASC LIMIT 1) AS right_image_url`

async function fetchRightImagesByRightIds(rightIds, connection = db) {
  const ids = [...new Set((rightIds || []).map((id) => Number(id)).filter((id) => id > 0))]
  if (!ids.length) return new Map()

  const [rows] = await connection.query(
    'SELECT right_id, image_url FROM right_images WHERE right_id IN (?) ORDER BY id ASC',
    [ids]
  )

  const map = new Map()
  for (const row of rows || []) {
    const key = row.right_id
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row.image_url || '')
  }
  return map
}

function attachRightImagesToOrderItems(items, imagesByRightId) {
  return (items || []).map((item) => {
    if (!item.right_id) return { ...item, images: [] }
    return {
      ...item,
      images: imagesByRightId.get(Number(item.right_id)) || [],
    }
  })
}

module.exports = {
  FIRST_RIGHT_IMAGE_SUBQUERY_SQL,
  fetchRightImagesByRightIds,
  attachRightImagesToOrderItems,
}
