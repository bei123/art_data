import imageCompression from 'browser-image-compression'
import { ElMessage } from 'element-plus'

/**
 * 检查浏览器是否支持 webp
 * @returns {boolean}
 */
function isSupportWebp() {
  try {
    const result = document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0;
    console.log('[webp] 浏览器webp支持检测:', result);
    return result;
  } catch (err) {
    console.log('[webp] 浏览器webp支持检测异常:', err);
    return false;
  }
}

/**
 * 通用图片上传前处理：webp压缩+5MB限制
 * @param {File} file 原始图片文件
 * @returns {Promise<File|false>} 压缩后webp文件或false
 */
export async function uploadImageToWebpLimit5MB(file) {
  console.log('[webp] 开始处理图片:', file);
  if (!isSupportWebp()) {
    ElMessage.error('当前浏览器不支持webp格式，请更换浏览器再上传！');
    console.log('[webp] 浏览器不支持webp，终止上传');
    return false;
  }
  const isImage = file.type.startsWith('image/');
  console.log('[webp] 文件类型检测:', file.type, 'isImage:', isImage);
  if (!isImage) {
    ElMessage.error('只能上传图片文件！');
    console.log('[webp] 文件不是图片，终止上传');
    return false;
  }
  const options = {
    maxSizeMB: 50,
    maxWidthOrHeight: 4096,
    fileType: 'image/webp',
    useWebWorker: true
  };
  try {
    console.log('[webp] 开始压缩图片，参数:', options);
    const compressedFile = await imageCompression(file, options);
    console.log('[webp] 压缩后文件:', compressedFile, 'type:', compressedFile.type, 'size:', compressedFile.size);
    let finalFile = compressedFile;
    // 如果压缩后不是webp格式，再用canvas转一次
    if (compressedFile.type !== 'image/webp') {
      try {
        console.log('[webp] 压缩后不是webp，尝试用canvas转换');
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = URL.createObjectURL(compressedFile);
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp'));
        console.log('[webp] canvas 导出结果:', blob, 'type:', blob && blob.type);
        if (!blob || blob.type !== 'image/webp') {
          ElMessage.error('canvas 导出 webp 失败，实际类型为 ' + (blob && blob.type));
          console.log('[webp] canvas 导出 webp 失败，实际类型为', blob && blob.type);
          return false;
        }
        finalFile = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
        console.log('[webp] canvas 转换后文件:', finalFile);
      } catch (e) {
        ElMessage.error('图片转换为webp失败！');
        console.log('[webp] canvas 转换异常:', e);
        return false;
      }
    }
    if (finalFile.size / 1024 / 1024 > 5) {
      ElMessage.error('图片压缩后仍超过5MB！');
      console.log('[webp] 压缩后仍超过5MB，终止上传');
      return false;
    }
    // 保证 webp 文件名后缀
    if (finalFile.type === 'image/webp' && !finalFile.name.endsWith('.webp')) {
      finalFile = new File([finalFile], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
      console.log('[webp] 修正文件名后缀为 .webp:', finalFile);
    }
    console.log('[webp] 最终返回文件:', finalFile, 'type:', finalFile.type, 'size:', finalFile.size);
    return finalFile;
  } catch (e) {
    ElMessage.error('图片压缩/转换失败！');
    console.log('[webp] 压缩/转换异常:', e);
    return false;
  }
} 