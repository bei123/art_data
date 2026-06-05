const db = require('../db');
const logger = require('../utils/logger');
const {
  DIGITAL_ARTWORKS_EXTERNAL_TABLE,
  parseDigitalArtworkId,
  fetchDigitalArtworkById,
  fetchDigitalArtworksByIds,
  hasEnoughDigitalStock,
  isDigitalArtworkPurchasable,
  ensureDigitalArtworkIdColumns,
  normalizeWespacePriceToYuan,
} = require('../utils/digitalArtworkResolver');
const { parseMoney, buildRightDiscountPricingByUser } = require('../utils/rightDiscountPricing');

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

async function getCartList(userId) {
  try {
    await ensureDigitalArtworkIdColumns();

    const [cartItems] = await db.query(
      'SELECT id, type, right_id, digital_artwork_id, artwork_id, quantity, price FROM cart_items WHERE user_id = ?',
      [userId]
    );

    if (!cartItems || cartItems.length === 0) {
      return adminResult(200, []);
    }

    const rightIds = [];
    const digitalIds = [];
    const artworkIds = [];
    cartItems.forEach((item) => {
      if (item.type === 'right' && item.right_id) rightIds.push(item.right_id);
      if (item.type === 'digital' && item.digital_artwork_id) digitalIds.push(item.digital_artwork_id);
      if (item.type === 'artwork' && item.artwork_id) artworkIds.push(item.artwork_id);
    });

    let rightsMap = {};
    if (rightIds.length > 0) {
      const [rights] = await db.query(
        `SELECT r.id,
                r.title,
                r.price,
                r.discount_price,
                r.original_price,
                r.status,
                r.remaining_count,
                r.category_id,
                c.title AS category_title
         FROM rights r
         LEFT JOIN physical_categories c ON r.category_id = c.id
         WHERE r.id IN (?) AND r.status = 'onsale'`,
        [rightIds]
      );
      rights.forEach((r) => {
        rightsMap[r.id] = r;
      });

      const [rightImages] = await db.query('SELECT right_id, image_url FROM right_images WHERE right_id IN (?)', [rightIds]);
      const rightImagesMap = {};
      rightImages.forEach((img) => {
        if (!rightImagesMap[img.right_id]) rightImagesMap[img.right_id] = [];
        rightImagesMap[img.right_id].push(img.image_url || '');
      });
      Object.keys(rightsMap).forEach((id) => {
        rightsMap[id].images = rightImagesMap[id] || [];
      });
    }

    const rightDiscountPricing = await buildRightDiscountPricingByUser(userId, rightsMap);

    let digitalsMap = {};
    let digitalArtistIds = [];
    if (digitalIds.length > 0) {
      const resolvedDigitals = await fetchDigitalArtworksByIds(digitalIds);
      const legacyIds = [];
      resolvedDigitals.forEach((record, id) => {
        digitalsMap[id] = record;
        if (record.source === 'legacy') legacyIds.push(id);
      });

      if (legacyIds.length > 0) {
        const [digitals] = await db.query(
          'SELECT id, title, price, image_url, description, artist_id FROM digital_artworks WHERE id IN (?)',
          [legacyIds]
        );
        digitals.forEach((d) => {
          const key = String(d.id);
          digitalsMap[key] = { ...digitalsMap[key], ...d };
          if (d.artist_id) digitalArtistIds.push(d.artist_id);
        });
      }

      const externalIds = [...resolvedDigitals.keys()].filter((id) => resolvedDigitals.get(id)?.source === 'external');
      if (externalIds.length > 0) {
        const [externals] = await db.query(
          `SELECT id, title, price, image_url, description, artist_id
           FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
           WHERE id IN (?)`,
          [externalIds]
        );
        externals.forEach((d) => {
          digitalsMap[String(d.id)] = {
            ...digitalsMap[String(d.id)],
            ...d,
            price: normalizeWespacePriceToYuan(d.price),
          };
          if (d.artist_id) digitalArtistIds.push(d.artist_id);
        });
      }
    }

    let artworksMap = {};
    let artistIds = [];
    if (artworkIds.length > 0) {
      const [artworks] = await db.query(
        `SELECT oa.id, oa.title, oa.image, oa.year, oa.description, oa.original_price, oa.discount_price, oa.artist_id
         FROM original_artworks oa
         INNER JOIN artists a ON a.id = oa.artist_id
         WHERE oa.id IN (?) AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1`,
        [artworkIds]
      );
      artworks.forEach((a) => {
        artworksMap[a.id] = a;
        if (a.artist_id) artistIds.push(a.artist_id);
      });
    }

    let artistsMap = {};
    const allArtistIds = Array.from(new Set([...artistIds, ...digitalArtistIds]));
    if (allArtistIds.length > 0) {
      const [artists] = await db.query('SELECT id, name, avatar FROM artists WHERE id IN (?)', [allArtistIds]);
      artists.forEach((a) => {
        artistsMap[a.id] = a;
      });
    }

    const result = cartItems.map((item) => {
      if (item.type === 'right' && rightsMap[item.right_id]) {
        const pricing = rightDiscountPricing[item.right_id] || {};
        const right = rightsMap[item.right_id];
        return {
          cart_item_id: item.id,
          ...item,
          type: 'right',
          ...right,
          eligible_digital_artwork_ids: pricing.eligible_digital_artwork_ids || [],
          owned_eligible_digital_artwork_ids: pricing.owned_eligible_digital_artwork_ids || [],
          has_discount: pricing.has_discount ?? false,
          discount_eligible: pricing.discount_eligible ?? false,
          effective_price: pricing.effective_price ?? parseMoney(right.price),
        };
      }
      if (item.type === 'digital' && digitalsMap[item.digital_artwork_id]) {
        const digital = digitalsMap[item.digital_artwork_id];
        const artist = artistsMap[digital.artist_id] || {};
        return {
          cart_item_id: item.id,
          ...item,
          type: 'digital',
          ...digital,
          image: digital.image_url || '',
          artist_name: artist.name || '',
        };
      }
      if (item.type === 'artwork' && artworksMap[item.artwork_id]) {
        const artwork = artworksMap[item.artwork_id];
        const artist = artistsMap[artwork.artist_id] || {};
        return {
          cart_item_id: item.id,
          ...item,
          type: 'artwork',
          ...artwork,
          image: artwork.image || '',
          artist_name: artist.name || '',
          artist_avatar: artist.avatar || '',
          price: item.price || 0,
          original_price: artwork.original_price || 0,
          discount_price: artwork.discount_price || 0,
        };
      }
      return {
        cart_item_id: item.id,
        ...item,
      };
    });

    return adminResult(200, result);
  } catch (error) {
    logger.error('getCartList failed', { err: error });
    return adminResult(500, { error: '获取购物车服务暂时不可用' });
  }
}

async function addCartItem(userId, body) {
  const { type = 'right', right_id, digital_artwork_id, artwork_id, quantity = 1 } = body || {};

  try {
    if (!['right', 'digital', 'artwork'].includes(type)) {
      return adminResult(400, { error: '无效的商品类型' });
    }

    const cleanQuantity = parseInt(quantity, 10);
    if (Number.isNaN(cleanQuantity) || cleanQuantity <= 0 || cleanQuantity > 99) {
      return adminResult(400, { error: '商品数量必须在1-99之间' });
    }

    if (type === 'right') {
      if (!right_id) {
        return adminResult(400, { error: '缺少商品ID' });
      }
      const [right] = await db.query('SELECT remaining_count FROM rights WHERE id = ? AND status = "onsale"', [right_id]);
      if (!right || right.length === 0) {
        return adminResult(404, { error: '商品不存在或已下架' });
      }
      if (right[0].remaining_count <= 0) {
        return adminResult(400, { error: '库存不足' });
      }
      const [existingItem] = await db.query(
        'SELECT id, quantity FROM cart_items WHERE user_id = ? AND right_id = ? AND type = "right"',
        [userId, right_id]
      );
      const cartQuantity = existingItem && existingItem.length > 0 ? existingItem[0].quantity : 0;
      if (cartQuantity + cleanQuantity > right[0].remaining_count) {
        return adminResult(400, { error: '加入购物车数量超过商品库存' });
      }
      if (existingItem && existingItem.length > 0) {
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND right_id = ? AND type = "right"',
          [cleanQuantity, userId, right_id]
        );
      } else {
        await db.query('INSERT INTO cart_items (user_id, type, right_id, quantity) VALUES (?, "right", ?, ?)', [
          userId,
          right_id,
          cleanQuantity,
        ]);
      }
      return adminResult(200, { message: '添加成功' });
    }

    if (type === 'digital') {
      await ensureDigitalArtworkIdColumns();

      const parsedDigitalId = parseDigitalArtworkId(digital_artwork_id);
      if (parsedDigitalId.error) {
        return adminResult(400, { error: parsedDigitalId.error });
      }

      const digital = await fetchDigitalArtworkById(parsedDigitalId.id);
      if (!digital || !isDigitalArtworkPurchasable(digital)) {
        return adminResult(404, { error: '数字艺术品不存在或已下架' });
      }
      if (!hasEnoughDigitalStock(digital, cleanQuantity)) {
        return adminResult(400, { error: '数字艺术品库存不足' });
      }

      const [existingItem] = await db.query(
        'SELECT id, quantity FROM cart_items WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"',
        [userId, parsedDigitalId.id]
      );
      const cartQuantity = existingItem && existingItem.length > 0 ? existingItem[0].quantity : 0;
      if (!hasEnoughDigitalStock(digital, cartQuantity + cleanQuantity)) {
        return adminResult(400, { error: '加入购物车数量超过数字艺术品库存' });
      }
      if (existingItem && existingItem.length > 0) {
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND digital_artwork_id = ? AND type = "digital"',
          [cleanQuantity, userId, parsedDigitalId.id]
        );
      } else {
        await db.query('INSERT INTO cart_items (user_id, type, digital_artwork_id, quantity) VALUES (?, "digital", ?, ?)', [
          userId,
          parsedDigitalId.id,
          cleanQuantity,
        ]);
      }
      return adminResult(200, { message: '添加成功' });
    }

    if (type === 'artwork') {
      if (!artwork_id) {
        return adminResult(400, { error: '缺少艺术品ID' });
      }
      const [artwork] = await db.query(
        `SELECT oa.original_price, oa.discount_price, oa.stock, oa.is_on_sale
         FROM original_artworks oa
         INNER JOIN artists a ON a.id = oa.artist_id
         WHERE oa.id = ? AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1`,
        [artwork_id]
      );
      if (!artwork || artwork.length === 0) {
        return adminResult(404, { error: '艺术品不存在' });
      }
      if (artwork[0].is_on_sale !== 1) {
        return adminResult(400, { error: '艺术品未上架' });
      }
      if (artwork[0].stock <= 0) {
        return adminResult(400, { error: '库存不足' });
      }
      const [existingItem] = await db.query(
        'SELECT id, quantity FROM cart_items WHERE user_id = ? AND artwork_id = ? AND type = "artwork"',
        [userId, artwork_id]
      );
      const cartQuantity = existingItem && existingItem.length > 0 ? existingItem[0].quantity : 0;
      if (cartQuantity + cleanQuantity > artwork[0].stock) {
        return adminResult(400, { error: '加入购物车数量超过库存' });
      }
      const actualPrice =
        artwork[0].discount_price &&
        artwork[0].discount_price > 0 &&
        artwork[0].discount_price < artwork[0].original_price
          ? artwork[0].discount_price
          : artwork[0].original_price;
      if (existingItem && existingItem.length > 0) {
        await db.query(
          'UPDATE cart_items SET quantity = quantity + ? WHERE user_id = ? AND artwork_id = ? AND type = "artwork"',
          [cleanQuantity, userId, artwork_id]
        );
      } else {
        await db.query(
          'INSERT INTO cart_items (user_id, type, artwork_id, quantity, price) VALUES (?, "artwork", ?, ?, ?)',
          [userId, artwork_id, cleanQuantity, actualPrice]
        );
      }
      return adminResult(200, { message: '添加成功' });
    }

    return adminResult(400, { error: '不支持的商品类型' });
  } catch (error) {
    logger.error('addCartItem failed', { err: error });
    return adminResult(500, { error: '添加商品到购物车失败' });
  }
}

async function updateCartItemQuantity(userId, rawCartItemId, body) {
  const cartItemId = parsePositiveIntId(rawCartItemId);
  if (!cartItemId) return adminResult(400, { error: '无效的购物车项ID' });

  const { quantity } = body || {};

  try {
    if (!quantity || quantity < 1) {
      return adminResult(400, { error: '数量必须大于0' });
    }

    const [cartItemRows] = await db.query(
      'SELECT type, right_id, digital_artwork_id, artwork_id FROM cart_items WHERE id = ? AND user_id = ?',
      [cartItemId, userId]
    );
    if (!cartItemRows || cartItemRows.length === 0) {
      return adminResult(404, { error: '购物车商品不存在' });
    }
    const cartItem = cartItemRows[0];

    if (cartItem.type === 'right') {
      const [rightRows] = await db.query('SELECT remaining_count FROM rights WHERE id = ? AND status = "onsale"', [cartItem.right_id]);
      if (!rightRows || rightRows.length === 0) {
        return adminResult(404, { error: '商品不存在或已下架' });
      }
      if (rightRows[0].remaining_count < quantity) {
        return adminResult(400, { error: '库存不足' });
      }
    } else if (cartItem.type === 'artwork') {
      const [artworkRows] = await db.query(
        `SELECT oa.stock
         FROM original_artworks oa
         INNER JOIN artists a ON a.id = oa.artist_id
         WHERE oa.id = ? AND oa.is_on_sale = 1
           AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1`,
        [cartItem.artwork_id]
      );
      if (!artworkRows || artworkRows.length === 0) {
        return adminResult(404, { error: '艺术品不存在或已下架' });
      }
      if (artworkRows[0].stock < quantity) {
        return adminResult(400, { error: '库存不足' });
      }
    } else if (cartItem.type === 'digital') {
      const digital = await fetchDigitalArtworkById(cartItem.digital_artwork_id);
      if (!digital || !isDigitalArtworkPurchasable(digital)) {
        return adminResult(404, { error: '数字艺术品不存在或已下架' });
      }
      if (!hasEnoughDigitalStock(digital, quantity)) {
        return adminResult(400, { error: '数字艺术品库存不足' });
      }
    } else {
      return adminResult(400, { error: '不支持的商品类型' });
    }

    await db.query('UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?', [quantity, cartItemId, userId]);

    return adminResult(200, { message: '更新成功' });
  } catch (error) {
    logger.error('updateCartItemQuantity failed', { err: error });
    return adminResult(500, { error: '更新购物车商品数量失败' });
  }
}

async function deleteCartItem(userId, rawCartItemId) {
  const cartItemId = parsePositiveIntId(rawCartItemId);
  if (!cartItemId) return adminResult(400, { error: '无效的购物车项ID' });

  try {
    const [result] = await db.query('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [cartItemId, userId]);

    if (result.affectedRows === 0) {
      return adminResult(404, { error: '购物车商品不存在' });
    }

    return adminResult(200, { message: '删除成功' });
  } catch (error) {
    logger.error('deleteCartItem failed', { err: error });
    return adminResult(500, { error: '从购物车中删除商品失败' });
  }
}

async function clearCart(userId) {
  try {
    await db.query('DELETE FROM cart_items WHERE user_id = ?', [userId]);
    return adminResult(200, { message: '清空购物车成功' });
  } catch (error) {
    logger.error('clearCart failed', { err: error });
    return adminResult(500, { error: '清空购物车失败' });
  }
}

module.exports = {
  getCartList,
  addCartItem,
  updateCartItemQuantity,
  deleteCartItem,
  clearCart,
};
