import imageCompression from 'browser-image-compression'
import { ElMessage } from 'element-plus'

/**
 * 通用图片上传前处理：webp压缩+5MB限制
 * @param {File} file 原始图片文件
 * @returns {Promise<File|false>} 压缩后webp文件或false
 */
export async function uploadImageToWebpLimit5MB(file) {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    ElMessage.error('只能上传图片文件！');
    return false;
  }
  const options = {
    maxSizeMB: 5,
    maxWidthOrHeight: 4096,
    fileType: 'image/webp',
    useWebWorker: true
  };
  try {
    const compressedFile = await imageCompression(file, options);
    let finalFile = compressedFile;
    // 如果压缩后不是webp格式，再用canvas转一次
    if (compressedFile.type !== 'image/webp') {
      try {
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
        if (!blob) throw new Error('canvas toBlob 失败');
        finalFile = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
      } catch (e) {
        ElMessage.error('图片转换为webp失败！');
        return false;
      }
    }
    if (finalFile.size / 1024 / 1024 > 5) {
      ElMessage.error('图片压缩后仍超过5MB！');
      return false;
    }
    return finalFile;
  } catch (e) {
    ElMessage.error('图片压缩/转换失败！');
    return false;
  }
} 