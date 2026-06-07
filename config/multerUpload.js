const multer = require('multer')
const path = require('path')

const MEDIA_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv',
]

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024
const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024

function createExtensionFileFilter(allowedExtensions) {
  const allowed = new Set(allowedExtensions.map((ext) => ext.toLowerCase()))

  return (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()

    if (!ext || !allowed.has(ext)) {
      return cb(new Error('不支持的文件类型'))
    }

    cb(null, true)
  }
}

function createMemoryUpload(options = {}) {
  const {
    allowedExtensions = MEDIA_EXTENSIONS,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = options

  return multer({
    storage: multer.memoryStorage(),
    fileFilter: createExtensionFileFilter(allowedExtensions),
    limits: { fileSize: maxFileSize },
  })
}

const adminMediaUpload = createMemoryUpload()
const merchantImageUpload = createMemoryUpload({
  allowedExtensions: IMAGE_EXTENSIONS,
  maxFileSize: IMAGE_MAX_FILE_SIZE,
})

module.exports = {
  MEDIA_EXTENSIONS,
  IMAGE_EXTENSIONS,
  DEFAULT_MAX_FILE_SIZE,
  IMAGE_MAX_FILE_SIZE,
  createExtensionFileFilter,
  createMemoryUpload,
  adminMediaUpload,
  merchantImageUpload,
}
