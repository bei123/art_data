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
    if (compressedFile.size / 1024 / 1024 > 5) {
      ElMessage.error('图片压缩后仍超过5MB！');
      return false;
    }
    return compressedFile;
  } catch (e) {
    ElMessage.error('图片压缩/转换失败！');
    return false;
  }
} 