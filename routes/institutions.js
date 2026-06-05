const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/institutionsService');

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicInstitutionsList(req.query);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取机构列表失败', { err: error });
    res.status(500).json({ error: '获取机构列表失败' });
  }
});

router.get('/:id/artists', async (req, res) => {
  try {
    const r = await svc.getInstitutionArtists(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取机构艺术家列表失败', { err: error });
    res.status(500).json({ error: '获取机构艺术家列表失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await svc.getPublicInstitutionDetail(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取机构详情失败', { err: error });
    res.status(500).json({ error: '获取机构详情服务暂时不可用' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const r = await svc.createInstitutionAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('创建机构失败', { err: error });
    res.status(500).json({ error: '创建机构服务暂时不可用' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.updateInstitutionAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新机构失败', { err: error });
    res.status(500).json({ error: '更新失败' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.deleteInstitutionAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('删除机构失败', { err: error });
    res.status(500).json({ error: '删除失败' });
  }
});

module.exports = router;
