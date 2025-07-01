const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadToOSS } = require('../config/oss');

// 用 multer 处理 form-data 文件
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.json({ errno: 1, message: '没有收到文件' });
  }
  try {
    // 传递 'editor/' 前缀，所有图片上传到 editor 文件夹
    const result = await uploadToOSS(req.file, 'editor/');
    res.json({
      errno: 0,
      data: {
        url: result.url
      }
    });
  } catch (e) {
    res.json({ errno: 1, message: '上传失败' });
  }
});

module.exports = router; 