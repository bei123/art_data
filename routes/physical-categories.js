const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { requireAdmin } = require('../auth');
const svc = require('../services/physicalCategoriesService');

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicPhysicalCategoriesList(req.query);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取实物分类列表失败', { err: error });
    res.status(500).json({ error: '获取实物分类数据服务暂时不可用' });
  }
});

router.post('/', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.createPhysicalCategoryAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('创建实物分类失败', { err: error });
    res.status(500).json({ error: '创建实物分类服务暂时不可用' });
  }
});

router.put('/:id', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.updatePhysicalCategoryAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新实物分类失败', { err: error });
    res.status(500).json({ error: '更新实物分类服务暂时不可用' });
  }
});

router.delete('/:id', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.deletePhysicalCategoryAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('删除实物分类失败', { err: error });
    res.status(500).json({ error: '删除实物分类服务暂时不可用' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await svc.getPublicPhysicalCategoryDetail(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取实物分类详情失败', { err: error });
    res.status(500).json({ error: '获取实物分类详情服务暂时不可用' });
  }
});

module.exports = router;
