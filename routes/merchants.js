const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const logger = require('../utils/logger');
const { requireAdmin } = require('../auth');
const svc = require('../services/merchantsService');

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicMerchantsList(req.query);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取商家列表失败', { err: error });
    res.status(500).json({
      success: false,
      error: '获取商家列表服务暂时不可用',
    });
  }
});

router.post('/upload-logo', ...requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const r = await svc.uploadMerchantLogo(req.file);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('商家Logo上传失败', { err: error });
    res.status(500).json({ error: '商家Logo上传失败' });
  }
});

router.post('/upload-images', ...requireAdmin, upload.array('images', 10), async (req, res) => {
  try {
    const r = await svc.uploadMerchantImages(req.files);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('商家图片上传失败', { err: error });
    res.status(500).json({ error: '商家图片上传失败' });
  }
});

router.post('/', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.createMerchantAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('创建商家失败', { err: error });
    res.status(500).json({
      success: false,
      error: '创建商家失败',
    });
  }
});

router.patch('/:id/status', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.patchMerchantStatusAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新商家状态失败', { err: error });
    res.status(500).json({
      success: false,
      error: '更新商家状态失败',
    });
  }
});

router.patch('/:id/sort', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.patchMerchantSortAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新商家排序失败', { err: error });
    res.status(500).json({
      success: false,
      error: '更新商家排序失败',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await svc.getPublicMerchantDetail(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取商家详情失败', { err: error });
    res.status(500).json({
      success: false,
      error: '获取商家详情服务暂时不可用',
    });
  }
});

router.put('/:id', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.updateMerchantAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新商家失败', { err: error });
    res.status(500).json({
      success: false,
      error: '更新商家失败',
    });
  }
});

router.delete('/:id', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.deleteMerchantAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('删除商家失败', { err: error });
    res.status(500).json({
      success: false,
      error: '删除商家失败',
    });
  }
});

module.exports = router;
