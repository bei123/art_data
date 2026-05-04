const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken, checkRole } = require('../auth');
const svc = require('../services/exhibitionsService');

router.use(async (req, res, next) => {
  try {
    await svc.ensureSchemaReady();
    next();
  } catch (e) {
    next(e);
  }
});

// 查询展览列表（公开）
router.get('/', async (req, res) => {
  try {
    const result = await svc.getPublicList(req.query);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(result.payload);
  } catch (e) {
    logger.error('get exhibitions failed', { err: e });
    res.status(500).json({ error: '获取展览列表失败' });
  }
});

// 查询展览详情（公开）
router.get('/:id', async (req, res) => {
  try {
    const result = await svc.loadPublicExhibitionDetailForApi(req.params.id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(result.body);
  } catch (e) {
    logger.error('get exhibition detail failed', { err: e });
    res.status(500).json({ error: '获取展览详情失败' });
  }
});

// 查询展览作品列表（公开）
router.get('/:id/items', async (req, res) => {
  try {
    const result = await svc.loadPublicExhibitionItemsForApi(req.params.id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(result.body);
  } catch (e) {
    logger.error('get exhibition items failed', { err: e });
    res.status(500).json({ error: '获取展览作品失败' });
  }
});

// 展览现场图列表（公开）
router.get('/:id/live-photos', async (req, res) => {
  try {
    const result = await svc.loadPublicExhibitionLivePhotosForApi(req.params.id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(result.body);
  } catch (e) {
    logger.error('get exhibition live photos failed', { err: e });
    res.status(500).json({ error: '获取展览现场图失败' });
  }
});

// 替换展览现场图（全量，需要 admin）
router.put('/:id/live-photos', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.replaceExhibitionLivePhotosAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('replace exhibition live photos failed', { err: e });
    res.status(500).json({ error: '更新展览现场图失败' });
  }
});

// 追加展览现场图（需要 admin）
router.post('/:id/live-photos', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.appendExhibitionLivePhotosAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('append exhibition live photos failed', { err: e });
    res.status(500).json({ error: '追加展览现场图失败' });
  }
});

// 删除单张展览现场图（需要 admin）
router.delete('/:exhibitionId/live-photos/:photoId', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.deleteExhibitionLivePhotoAdmin(req.params.exhibitionId, req.params.photoId);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('delete exhibition live photo failed', { err: e });
    res.status(500).json({ error: '删除展览现场图失败' });
  }
});

// 创建展览（需要 admin）
router.post('/', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.createExhibitionAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('create exhibition failed', { err: e });
    res.status(500).json({ error: '创建展览失败' });
  }
});

// 修改展览（需要 admin）
router.put('/:id', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.updateExhibitionAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('update exhibition failed', { err: e });
    res.status(500).json({ error: '更新展览失败' });
  }
});

// 追加展览作品（需要 admin）
router.post('/:id/items', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.appendExhibitionItemsAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('append exhibition items failed', { err: e });
    res.status(500).json({ error: '追加展览作品失败' });
  }
});

// 替换展览作品（需要 admin）
router.put('/:id/items', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.replaceExhibitionItemsAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('replace exhibition items failed', { err: e });
    res.status(500).json({ error: '替换展览作品失败' });
  }
});

// 为某个展览作品关联/更新艺术家（需要 admin）
router.put('/:exhibitionId/items/:itemId/artists', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.updateExhibitionItemArtistsAdmin(req.params.exhibitionId, req.params.itemId, req.body);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('update exhibition item artists failed', { err: e });
    res.status(500).json({ error: '更新艺术家关联失败' });
  }
});

// 移除展览作品（需要 admin）
router.delete('/:exhibitionId/items/:itemId', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const r = await svc.deleteExhibitionItemAdmin(req.params.exhibitionId, req.params.itemId);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('delete exhibition item failed', { err: e });
    res.status(500).json({ error: '移除失败' });
  }
});

module.exports = router;

