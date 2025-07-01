const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadToOSS } = require('../config/oss');

// 用 multer 处理 form-data 文件
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/', upload.single('file'), async (req, res) => {
  console.log('收到上传请求，req.file:', req.file);
  if (!req.file) {
    console.error('没有收到文件');
    return res.json({ errno: 1, message: '没有收到文件' });
  }
  try {
    // 传递 'editor/' 前缀，所有图片上传到 editor 文件夹
    const result = await uploadToOSS(req.file, 'editor/');
    console.log('OSS 上传结果:', result);
    res.json({
      errno: 0,
      data: {
        url: result.url
      },
      url: result.url,
      name: result.name // 关键：加上 name 字段，兼容 el-upload
    });
  } catch (e) {
    console.error('OSS 上传异常:', e);
    res.json({ errno: 1, message: '上传失败' });
  }
});

module.exports = router; 