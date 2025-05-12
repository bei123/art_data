const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api.wx.2000gallery.art:2000'
  : 'http://localhost:2000';

/**
 * 处理图片URL，添加WebP转换参数
 * @param {string} url - 原始图片URL
 * @returns {string} - 处理后的URL
 */
function processImageUrl(url) {
  // 检查url是否为字符串类型
  if (typeof url !== 'string' || !url) {
    return url;
  }

  // 如果是OSS的图片，添加WebP转换参数
  if (url.includes('wx.oss.2000gallery.art')) {
    return `${url}?x-oss-process=image/format,webp`;
  }

  // 如果是相对路径，添加完整URL
  if (url.startsWith('/')) {
    return `${API_BASE_URL}${url}`;
  }

  return url;
}

/**
 * 处理对象中的图片URL
 * @param {Object} obj - 包含图片URL的对象
 * @param {string[]} imageFields - 需要处理的图片字段名数组
 * @returns {Object} - 处理后的对象
 */
function processObjectImages(obj, imageFields = ['image', 'avatar', 'banner']) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const result = { ...obj };

  // 处理指定的图片字段
  imageFields.forEach(field => {
    if (field in result) {
      if (Array.isArray(result[field])) {
        // 如果是图片数组，处理每个URL
        result[field] = result[field].map(url => processImageUrl(url));
      } else {
        // 如果是单个图片URL
        result[field] = processImageUrl(result[field]);
      }
    }
  });

  return result;
}

module.exports = {
  processImageUrl,
  processObjectImages
}; 