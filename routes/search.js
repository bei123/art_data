const express = require('express');
const router = express.Router();
const db = require('../db');
const BASE_URL = 'https://api.wx.2000gallery.art:2000';
// 搜索接口
router.get('/', async (req, res) => {
  try {
    const { keyword, type, page = 1, limit = 10 } = req.query;

    // 输入验证
    if (!keyword || typeof keyword !== 'string') {
      return res.status(400).json({ error: '请输入有效的搜索关键词' });
    }

    // 清理和验证关键词
    const cleanKeyword = keyword.trim();
    if (cleanKeyword.length < 1 || cleanKeyword.length > 100) {
      return res.status(400).json({ error: '搜索关键词长度必须在1-100个字符之间' });
    }

    // 检查是否包含危险字符
    const dangerousChars = /[<>'"&]/;
    if (dangerousChars.test(cleanKeyword)) {
      return res.status(400).json({ error: '搜索关键词包含无效字符' });
    }

    // 分页参数验证
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: '分页参数无效，page必须大于0，limit必须在1-100之间' });
    }

    const offset = (pageNum - 1) * limitNum;
    const searchTerm = `%${cleanKeyword}%`;
    let results = [];
    let totalCount = 0;

    // 按类型搜索
    if (!type || type === 'all') {
      // 全部类型 - 先获取总数
      const [artistCount] = await db.query(
        `SELECT COUNT(*) as count FROM artists WHERE name LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
      );
      const [artworkCount] = await db.query(
        `SELECT COUNT(*) as count FROM original_artworks WHERE title LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
      );
      const [digitalCount] = await db.query(
        `SELECT COUNT(*) as count FROM digital_artworks WHERE title LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
      );
      totalCount = artistCount[0].count + artworkCount[0].count + digitalCount[0].count;

      // 获取分页数据
      const [artistRows] = await db.query(
        `SELECT id, name, avatar, description, 'artist' as type 
           FROM artists 
           WHERE name LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
      );
      const [artworkRows] = await db.query(
        `SELECT id, title, image, description, 'original_artwork' as type 
           FROM original_artworks 
           WHERE title LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
      );
      const [digitalRows] = await db.query(
        `SELECT id, title, image_url as image, description, 'digital_artwork' as type 
           FROM digital_artworks 
           WHERE title LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
      );
      results = [
        ...artistRows.map(item => ({
          ...item,
          avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : ''
        })),
        ...artworkRows.map(item => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
        })),
        ...digitalRows.map(item => ({
          ...item,
          image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
        }))
      ];
    } else if (type === 'artist') {
      // 获取总数
      const [countResult] = await db.query(
        `SELECT COUNT(*) as count FROM artists WHERE name LIKE ? OR description LIKE ?`,
        [searchTerm, searchTerm]
      );
      totalCount = countResult[0].count;

      const [artistRows] = await db.query(
        `SELECT id, name, avatar, description, 'artist' as type 
           FROM artists 
           WHERE name LIKE ? OR description LIKE ?
           LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limitNum, offset]
      );
      results = artistRows.map(item => ({
        ...item,
        avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : ''
      }));
    } else if (type === 'original_artwork') {
      // 获取总数 - 使用全文搜索优化
      const [countResult] = await db.query(
        `SELECT COUNT(*) as count 
           FROM original_artworks oa
           LEFT JOIN artists a ON oa.artist_id = a.id
           WHERE MATCH(oa.title, oa.description) AGAINST(? IN NATURAL LANGUAGE MODE) 
              OR MATCH(a.name) AGAINST(? IN NATURAL LANGUAGE MODE)`,
        [cleanKeyword, cleanKeyword]
      );
      totalCount = countResult[0].count;

      // 查询作品及其艺术家信息，使用全文搜索优化
      const [artworkRows] = await db.query(
        `SELECT oa.id, oa.title, oa.image, oa.description, oa.artist_id, a.name as artist_name, a.avatar as artist_avatar, 'original_artwork' as type 
           FROM original_artworks oa
           LEFT JOIN artists a ON oa.artist_id = a.id
           WHERE MATCH(oa.title, oa.description) AGAINST(? IN NATURAL LANGUAGE MODE) 
              OR MATCH(a.name) AGAINST(? IN NATURAL LANGUAGE MODE)
           LIMIT ? OFFSET ?`,
        [cleanKeyword, cleanKeyword, limitNum, offset]
      );
      results = artworkRows.map(item => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        artist_avatar: item.artist_avatar ? (item.artist_avatar.startsWith('http') ? item.artist_avatar : `${BASE_URL}${item.artist_avatar}`) : ''
      }));
    } else if (type === 'digital_artwork') {
      // 获取总数 - 使用全文搜索优化
      const [countResult] = await db.query(
        `SELECT COUNT(*) as count 
           FROM digital_artworks da
           LEFT JOIN artists a ON da.artist_id = a.id
           WHERE MATCH(da.title, da.description) AGAINST(? IN NATURAL LANGUAGE MODE)
              OR MATCH(a.name) AGAINST(? IN NATURAL LANGUAGE MODE)`,
        [cleanKeyword, cleanKeyword]
      );
      totalCount = countResult[0].count;

      // 查询数字艺术品及其艺术家信息，使用全文搜索优化
      const [digitalRows] = await db.query(
        `SELECT da.id, da.title, da.image_url as image, da.description, da.artist_id, a.name as artist_name, a.avatar as artist_avatar, 'digital_artwork' as type 
           FROM digital_artworks da
           LEFT JOIN artists a ON da.artist_id = a.id
           WHERE MATCH(da.title, da.description) AGAINST(? IN NATURAL LANGUAGE MODE)
              OR MATCH(a.name) AGAINST(? IN NATURAL LANGUAGE MODE)
           LIMIT ? OFFSET ?`,
        [cleanKeyword, cleanKeyword, limitNum, offset]
      );
      results = digitalRows.map(item => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : '',
        artist_avatar: item.artist_avatar ? (item.artist_avatar.startsWith('http') ? item.artist_avatar : `${BASE_URL}${item.artist_avatar}`) : ''
      }));
    } else {
      return res.status(400).json({ error: '不支持的type类型' });
    }

    // 计算分页信息
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNext = pageNum < totalPages;
    const hasPrev = pageNum > 1;

    res.json({
      data: results,
      pagination: {
        current_page: pageNum,
        page_size: limitNum,
        total_count: totalCount,
        total_pages: totalPages,
        has_next: hasNext,
        has_prev: hasPrev
      }
    });
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(500).json({ error: '搜索服务暂时不可用，请稍后再试' });
  }
});

module.exports = router;