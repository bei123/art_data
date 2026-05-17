const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { optionalAuthenticate } = require('../auth');
const svc = require('../services/searchService');

router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const r = await svc.getSearchResults(req.query, Boolean(req.includeHidden));
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('搜索失败', { err: error });
    res.status(500).json({ error: '搜索服务暂时不可用，请稍后再试' });
  }
});

module.exports = router;
