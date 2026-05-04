const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/artworksService');

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicArtworksList(req.query);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取艺术品列表失败', { err: error });
    res.status(500).json({ error: '获取艺术品列表失败' });
  }
});

router.get('/performance/metrics', async (req, res) => {
  try {
    const r = await svc.getArtworksPerformanceMetrics();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取性能指标失败', { err: error });
    res.status(500).json({ error: '获取性能指标失败' });
  }
});

router.post('/performance/clear-cache', authenticateToken, async (req, res) => {
  try {
    const r = await svc.clearArtworksPerformanceCacheAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('清理缓存失败', { err: error });
    res.status(500).json({ error: '清理缓存失败' });
  }
});

router.post('/performance/reset', authenticateToken, async (req, res) => {
  try {
    const r = await svc.resetArtworksPerformanceMetrics();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('重置性能统计失败', { err: error });
    res.status(500).json({ error: '重置性能统计失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await svc.getPublicArtworkDetail(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取作品详情失败', { err: error });
    res.status(500).json({ error: '获取作品详情服务暂时不可用' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const r = await svc.createOriginalArtworkAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('创建艺术品失败', { err: error });
    res.status(500).json({ error: '创建失败' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.updateOriginalArtworkAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新艺术品失败', { err: error });
    res.status(500).json({ error: '更新失败' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.deleteOriginalArtworkAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('删除艺术品失败', { err: error });
    res.status(500).json({ error: '删除失败' });
  }
});

module.exports = router;
