const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken, optionalAuthenticate } = require('../auth');
const svc = require('../services/artistsService');

router.use(async (req, res, next) => {
  try {
    await svc.ensureArtistSchemaReady();
    next();
  } catch (e) {
    next(e);
  }
});

router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const r = await svc.getPublicArtistsList(req.query, Boolean(req.includeHidden));
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取艺术家列表失败', { err: error });
    res.status(500).json({ error: '获取艺术家列表失败' });
  }
});

router.get('/:id/featured-artworks', optionalAuthenticate, async (req, res) => {
  try {
    const r = await svc.getPublicFeaturedArtworks(req.params.id, Boolean(req.includeHidden));
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取代表作品失败', { err: error });
    res.status(500).json({ error: '获取代表作品失败' });
  }
});

router.get('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const r = await svc.getPublicArtistDetail(req.params.id, Boolean(req.includeHidden));
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取艺术家详情失败', { err: error });
    res.status(500).json({ error: '获取艺术家详情服务暂时不可用' });
  }
});

router.post('/bulk-delete', authenticateToken, async (req, res) => {
  try {
    const r = await svc.bulkDeleteArtistsAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('批量删除艺术家失败', { err: error });
    res.status(500).json({ error: '批量删除失败' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const r = await svc.createArtistAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('Error creating artist', { err: error });
    res.status(500).json({ error: '创建艺术家服务暂时不可用' });
  }
});

router.put('/:id/featured-artworks', authenticateToken, async (req, res) => {
  try {
    const r = await svc.setFeaturedArtworksAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('设置代表作品失败', { err: error });
    res.status(500).json({ error: '设置代表作品失败' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.updateArtistAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('Error updating artist', { err: error });
    res.status(500).json({ error: '更新失败' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.deleteArtistAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('Error deleting artist', { err: error });
    res.status(500).json({ error: '删除失败' });
  }
});

module.exports = router;
