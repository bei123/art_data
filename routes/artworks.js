const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken, checkRole, optionalAuthenticate } = require('../auth');
const svc = require('../services/artworksService');
const wmsSync = require('../services/wmsProductSyncService');
const wmsArtworkImage = require('../services/wmsArtworkImageService');

function authenticateTokenAllowQuery(req, res, next) {
  if (!req.headers.authorization && req.query?.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return authenticateToken(req, res, next);
}

router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const r = await svc.getPublicArtworksList(req.query, Boolean(req.includeHidden));
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

/** 从 WMS 同步原作（管理员）；需 .env 中 WMS_HTTP_* 与库表 wms_record_id 迁移 */
router.post(
  '/admin/sync-from-wms',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const r = await wmsSync.syncFromWmsAdmin(req.body || {});
      return res.status(r.status).json(r.body);
    } catch (error) {
      logger.error('WMS 同步失败', { err: error });
      res.status(500).json({ error: 'WMS 同步失败' });
    }
  }
);

/** 管理端：代理预览 WMS 仓库图（img 标签可用 query.token 传 JWT） */
router.get(
  '/:id/admin/wms-image',
  authenticateTokenAllowQuery,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const r = await wmsArtworkImage.streamWmsArtworkImageAdmin(req.params.id, req.query, res);
      if (r) return res.status(r.status).json(r.body);
    } catch (error) {
      logger.error('WMS 仓库图预览失败', { err: error });
      res.status(500).json({ error: '拉取仓库图片失败' });
    }
  }
);

/** 管理端：采用仓库图 → 上传 OSS → 写入 image 字段对外展示 */
router.post(
  '/:id/admin/apply-wms-image',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const r = await wmsArtworkImage.applyWmsImageToArtworkAdmin(req.params.id, req.body || {});
      return res.status(r.status).json(r.body);
    } catch (error) {
      logger.error('采用 WMS 仓库图失败', { err: error });
      res.status(500).json({ error: '采用仓库图片失败' });
    }
  }
);

router.patch('/:id/is-public', authenticateToken, async (req, res) => {
  try {
    const r = await svc.patchOriginalArtworkIsPublicAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新原作展示状态失败', { err: error });
    res.status(500).json({ error: '更新原作展示状态失败' });
  }
});

router.get('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const r = await svc.getPublicArtworkDetail(req.params.id, Boolean(req.includeHidden));
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取作品详情失败', { err: error });
    res.status(500).json({ error: '获取作品详情服务暂时不可用' });
  }
});

router.post('/bulk-delete', authenticateToken, async (req, res) => {
  try {
    const r = await svc.bulkDeleteOriginalArtworksAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('批量删除艺术品失败', { err: error });
    res.status(500).json({ error: '批量删除失败' });
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
