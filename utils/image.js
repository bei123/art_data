const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:2000'
  : 'https://api.wx.2000gallery.art:2000';

/**
 * 处理图片URL，添加WebP转换参数
 * @param {string} url - 原始图片URL
 * @returns {string} - 处理后的URL
 */
function processImageUrl(url) {
  if (!url) return '';
  
  // 如果是OSS图片，添加WebP转换参数
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return `${url}?x-oss-process=image/format,webp`;
  }
  
  // 如果是相对路径，添加基础URL
  if (!url.startsWith('http')) {
    return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}?x-oss-process=image/format,webp`;
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
  if (!obj) return obj;
  
  const result = { ...obj };
  
  // 处理单个图片字段
  imageFields.forEach(field => {
    if (result[field]) {
      result[field] = processImageUrl(result[field]);
    }
  });
  
  // 处理图片数组
  if (Array.isArray(result.images)) {
    result.images = result.images.map(img => processImageUrl(img));
  }
  
  return result;
}

module.exports = {
  processImageUrl,
  processObjectImages
}; 