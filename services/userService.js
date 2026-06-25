const db = require('../db');
const logger = require('../utils/logger');
const { PUBLIC_API_BASE_URL: BASE_URL } = require('../config/publicEnv');
const { ensureOrderItemsQrCodeColumns } = require('../utils/orderItemsSchema');
const {
  DIGITAL_ITEM_JOIN_SQL,
  DIGITAL_ITEM_SELECT_SQL,
  ensureDigitalArtworkIdColumns,
} = require('../utils/digitalArtworkResolver');
const { buildListEnvelope, buildPaginationMeta } = require('../utils/apiListEnvelope');
const { FIRST_RIGHT_IMAGE_SUBQUERY_SQL } = require('../utils/rightImagesQuery');
const { parseListPageParams } = require('../utils/listQuery');

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function mapPurchasedProductItem(item) {
  let product = {
    id: item.id,
    type: item.type,
    quantity: item.quantity,
    price: item.price,
  };
  if (item.type === 'right') {
    product = {
      ...product,
      right_id: item.right_id,
      artist_id: null,
      title: item.right_title,
      original_price: item.right_original_price,
      description: item.right_description,
      images: item.right_image_url ? [item.right_image_url] : [],
    };
  } else if (item.type === 'digital') {
    const qrCodeUrl = item.delivery_qr_code_url || null;
    product = {
      ...product,
      digital_artwork_id:
        item.digital_artwork_id != null ? String(item.digital_artwork_id) : null,
      artist_id: item.digital_artist_id,
      artist_name: item.digital_artist_name || '',
      artist_avatar: item.digital_artist_avatar
        ? item.digital_artist_avatar.startsWith('http')
          ? item.digital_artist_avatar
          : `${BASE_URL}${item.digital_artist_avatar}`
        : '',
      title: item.digital_title,
      description: item.digital_description,
      images: item.digital_image_url ? [item.digital_image_url] : [],
      issuer: item.digital_issuer || '',
      qr_code_url: qrCodeUrl,
      qr_code_uploaded_at: item.delivery_qr_code_at || null,
    };
  } else if (item.type === 'artwork') {
    product = {
      ...product,
      artwork_id: item.artwork_id,
      artist_id: item.artwork_artist_id,
      artist_name: item.artwork_artist_name || '',
      artist_avatar: item.artwork_artist_avatar
        ? item.artwork_artist_avatar.startsWith('http')
          ? item.artwork_artist_avatar
          : `${BASE_URL}${item.artwork_artist_avatar}`
        : '',
      title: item.artwork_title,
      original_price: item.artwork_original_price,
      discount_price: item.artwork_discount_price,
      description: item.artwork_description,
      images: item.artwork_image ? [item.artwork_image] : [],
    };
  }
  return product;
}

async function getPurchasedProducts(userId, query = {}) {
  try {
    await ensureOrderItemsQrCodeColumns();
    await ensureDigitalArtworkIdColumns();

    const { page, pageSize, offset, explicit } = parseListPageParams(query, { defaultPageSize: 50 });

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM order_items oi
       INNER JOIN orders o ON oi.order_id = o.id
       WHERE o.user_id = ? AND o.trade_state = ?`,
      [userId, 'SUCCESS']
    );
    const totalCount = Number(total) || 0;
    if (totalCount === 0) {
      return adminResult(200, buildListEnvelope([]));
    }

    const [items] = await db.query(
      `
      SELECT 
        oi.id,
        oi.type,
        oi.right_id,
        oi.digital_artwork_id,
        oi.artwork_id,
        oi.quantity,
        oi.price,
        oi.delivery_qr_code_url,
        oi.delivery_qr_code_at,
        r.title as right_title,
        r.price as right_price,
        r.original_price as right_original_price,
        r.description as right_description,
        ${FIRST_RIGHT_IMAGE_SUBQUERY_SQL},
        ${DIGITAL_ITEM_SELECT_SQL},
        COALESCE(da.artist_id, dae.artist_id) as digital_artist_id,
        a1.name as digital_artist_name,
        a1.avatar as digital_artist_avatar,
        oa.title as artwork_title,
        oa.original_price as artwork_original_price,
        oa.discount_price as artwork_discount_price,
        oa.description as artwork_description,
        oa.image as artwork_image,
        oa.artist_id as artwork_artist_id,
        a2.name as artwork_artist_name,
        a2.avatar as artwork_artist_avatar
      FROM order_items oi
      INNER JOIN orders o ON oi.order_id = o.id
      LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
      ${DIGITAL_ITEM_JOIN_SQL}
      LEFT JOIN artists a1 ON COALESCE(da.artist_id, dae.artist_id) = a1.id
      LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
      LEFT JOIN artists a2 ON oa.artist_id = a2.id
      WHERE o.user_id = ? AND o.trade_state = ?
      ORDER BY o.created_at DESC, oi.id DESC
      LIMIT ? OFFSET ?
    `,
      [userId, 'SUCCESS', pageSize, offset]
    );

    const result = (items || []).map(mapPurchasedProductItem);
    const pagination = buildPaginationMeta({ page, pageSize, total: totalCount });
    if (!explicit && totalCount <= pageSize) {
      return adminResult(200, buildListEnvelope(result));
    }
    return adminResult(200, buildListEnvelope(result, pagination));
  } catch (error) {
    logger.error('getPurchasedProducts failed', { err: error });
    return adminResult(500, { error: '获取已购产品失败' });
  }
}

module.exports = {
  getPurchasedProducts,
};
