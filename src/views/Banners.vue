<template>
  <div>
    <div class="header">
      <h3>轮播图管理</h3>
      <el-button type="primary" @click="handleAdd">添加轮播图</el-button>
    </div>

    <el-table :data="banners" style="width: 100%">
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片">
        <template #default="{ row }">
          <el-image
            style="width: 200px; height: 100px"
            :src="getImageUrl(row.image_url)"
            fit="cover"
          />
        </template>
      </el-table-column>
      <el-table-column prop="link_url" label="链接" />
      <el-table-column prop="sort_order" label="排序" width="100" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑轮播图' : '添加轮播图'"
      width="50%"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="图片" required>
          <div class="image-upload-container">
            <!-- 图片预览区域 -->
            <div class="image-preview" v-if="form.image_url">
              <img :src="getImageUrl(form.image_url)" class="preview-image" alt="轮播图" />
              <div class="image-overlay">
                <el-button 
                  type="danger" 
                  size="small" 
                  circle 
                  @click="removeImage"
                  class="remove-btn"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="triggerImageInput"
                  class="replace-btn"
                >
                  更换图片
                </el-button>
              </div>
            </div>

            <!-- 上传区域 -->
            <div 
              v-else
              class="upload-zone"
              :class="{ 
                'drag-over': isImageDragOver, 
                'uploading': isImageUploading || isImageProcessing 
              }"
              @click="triggerImageInput"
              @dragenter="handleImageDragEnter"
              @dragleave="handleImageDragLeave"
              @dragover="handleImageDragOver"
              @drop="handleImageDrop"
            >
              <div class="upload-content">
                <el-icon class="upload-icon" :class="{ 'spinning': isImageUploading || isImageProcessing }">
                  <component :is="(isImageUploading || isImageProcessing) ? 'Loading' : 'Upload'" />
                </el-icon>
                <div class="upload-text">
                  <p class="upload-title">
                    {{ isImageProcessing ? '正在处理图片...' : isImageUploading ? '正在上传...' : '点击或拖拽图片到此处上传' }}
                  </p>
                  <p class="upload-hint">支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内</p>
                </div>
              </div>
              
              <!-- 拖拽提示遮罩 -->
              <div v-if="isImageDragOver && !form.image_url" class="drag-overlay">
                <el-icon class="drag-icon"><Upload /></el-icon>
                <p>释放鼠标上传图片</p>
              </div>
            </div>

            <!-- 隐藏的文件输入 -->
            <input
              ref="imageInput"
              type="file"
              accept="image/*"
              style="display: none"
              @change="handleImageFileSelect"
            />

            <!-- 图片处理提示 -->
            <div v-if="isImageProcessing" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">图片处理中</span>
                <span class="progress-percentage">处理中...</span>
              </div>
              <el-progress 
                :percentage="0" 
                :stroke-width="6"
                :show-text="false"
                :indeterminate="true"
                :color="progressColors"
              />
              <div class="progress-info">
                <span class="file-name">{{ imageFileName }}</span>
                <span class="file-size">{{ formatFileSize(imageFileSize) }}</span>
              </div>
              <div class="processing-hint">
                <p>正在将图片转换为 WebP 格式并压缩...</p>
              </div>
            </div>

            <!-- 上传进度条 -->
            <div v-if="imageUploadProgress > 0 && imageUploadProgress < 100 && !isImageProcessing" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">上传进度</span>
                <span class="progress-percentage">{{ imageUploadProgress }}%</span>
              </div>
              <el-progress 
                :percentage="imageUploadProgress" 
                :stroke-width="6"
                :show-text="false"
                :color="progressColors"
              />
              <div class="progress-info">
                <span class="file-name">{{ imageFileName }}</span>
                <span class="file-size">{{ formatFileSize(imageFileSize) }}</span>
              </div>
            </div>

            <!-- 上传完成提示 -->
            <div v-if="imageUploadProgress === 100" class="upload-success">
              <el-alert
                title="图片上传成功！"
                type="success"
                :closable="false"
                show-icon
              />
            </div>
          </div>
        </el-form-item>
        <el-form-item label="链接">
          <el-input v-model="form.link_url" placeholder="请输入点击轮播图后跳转的链接" />
        </el-form-item>
        <el-form-item label="链接快捷选择">
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; width: 100%">
            <el-select v-model="form.link_type" placeholder="选择类型" style="width: 160px" @change="handleLinkTypeChange">
              <el-option v-for="opt in linkTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <el-select
              v-if="form.link_type === 'original'"
              v-model="form.original_artist_id"
              placeholder="选择艺术家"
              filterable
              :loading="artistOptionsLoading"
              style="min-width: 200px"
              @visible-change="onArtistSelectVisibleChange"
              @change="handleOriginalArtistChange"
            >
              <el-option
                v-for="a in artistOptions"
                :key="a.value"
                :label="a.label"
                :value="a.value"
              />
            </el-select>
            <el-select
              v-model="form.link_id"
              placeholder="选择具体项"
              filterable
              :disabled="!form.link_type || (form.link_type === 'original' && !form.original_artist_id)"
              :loading="linkOptionsLoading"
              style="min-width: 260px; flex: 1"
              @visible-change="onLinkSelectVisibleChange"
              @change="applyComposedLink"
            >
              <el-option
                v-for="item in linkOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <span v-if="form.link_type && form.link_id" style="color:#909399; font-size: 12px;">
              将生成：{{ composedLinkPreview }}
            </span>
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Delete, Loading } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const banners = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)

// 图片上传相关状态
const imageInput = ref(null)
const isImageDragOver = ref(false)
const imageUploadProgress = ref(0)
const isImageUploading = ref(false)
const isImageProcessing = ref(false)
const imageFileName = ref('')
const imageFileSize = ref(0)

// 进度条颜色配置
const progressColors = [
  { color: '#f56c6c', percentage: 20 },
  { color: '#e6a23c', percentage: 40 },
  { color: '#5cb87a', percentage: 60 },
  { color: '#1989fa', percentage: 80 },
  { color: '#6f7ad3', percentage: 100 }
]
const form = ref({
  title: '',
  image_url: '',
  link_url: '',
  sort_order: 0,
  status: 'active',
  // 链接快捷选择
  link_type: '',
  link_id: null,
  original_artist_id: null
})

// 链接类型与快捷选择
const linkTypeOptions = [
  { label: '数字艺术品', value: 'digital' },
  { label: '权益', value: 'rights' },
  { label: '原作', value: 'original' },
  { label: '艺术家', value: 'artist' }
]
const linkOptionsLoading = ref(false)
const linkOptions = ref([])
const artistOptionsLoading = ref(false)
const artistOptions = ref([])
// 原作分页聚合配置
const ORIGINAL_PAGE_SIZE = 50
const ORIGINAL_MAX_PAGES = 5
const linkPathMap = {
  digital: '/pages/digital/detail',
  rights: '/pages/rights/detail',
  original: '/pages/artwork/detail',
  artist: '/pages/artist/detail'
}
const composedLinkPreview = computed(() => {
  if (!form.value.link_type || !form.value.link_id) return ''
  const base = linkPathMap[form.value.link_type]
  return `${base}?id=${form.value.link_id}`
})

const fetchBanners = async () => {
  try {
    const res = await axios.get('/banners/all')
    console.log('原始数据:', res)
    const arr = Array.isArray(res) ? res : []
    banners.value = arr.map(banner => {
      console.log('处理单个banner:', banner)
      return {
        ...banner,
        image_url: getImageUrl(banner.image_url)
      }
    })
    console.log('处理后的banners:', banners.value)
  } catch (error) {
    console.error('获取轮播图列表失败：', error)
    ElMessage.error('获取轮播图列表失败')
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    title: '',
    image_url: '',
    link_url: '',
    sort_order: 0,
    status: 'active',
    link_type: '',
    link_id: null
  }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = { ...row }
  // 解析已有链接以回填快捷选择
  tryParseExistingLink(row.link_url)
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除这个轮播图吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await axios.delete(`/banners/${row.id}`)
      ElMessage.success('删除成功')
      fetchBanners()
    } catch (error) {
      ElMessage.error('删除失败')
    }
  })
}

// 图片上传相关函数
const triggerImageInput = () => {
  if (!isImageUploading.value && !isImageProcessing.value) {
    imageInput.value?.click()
  }
}

const handleImageFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadImageFile(file)
  }
  event.target.value = ''
}

const uploadImageFile = async (file) => {
  imageUploadProgress.value = 0
  isImageUploading.value = true
  isImageProcessing.value = true
  imageFileName.value = file.name
  imageFileSize.value = file.size

  try {
    console.log('开始处理图片文件:', file.name, file.size)
    const processedFile = await uploadImageToWebpLimit5MB(file)
    
    if (!processedFile) {
      console.log('图片处理失败，终止上传')
      resetImageUploadState()
      return
    }

    console.log('图片处理成功:', processedFile.name, processedFile.size)
    
    isImageProcessing.value = false
    imageFileName.value = processedFile.name
    imageFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          imageUploadProgress.value = percent
        } else {
          imageUploadProgress.value = Math.min(imageUploadProgress.value + 10, 90)
        }
      }
    })

    handleImageUploadSuccess(response)
  } catch (error) {
    handleImageUploadError(error)
  }
}

const handleImageUploadSuccess = (response) => {
  console.log('图片上传成功响应:', response)
  
  let imageUrl = ''
  
  if (response && response.url) {
    imageUrl = response.url
  } else if (response && response.data && response.data.url) {
    imageUrl = response.data.url
  } else if (response && response.data && typeof response.data === 'string') {
    imageUrl = response.data
  } else if (typeof response === 'string') {
    imageUrl = response
  } else if (response && response.path) {
    imageUrl = response.path
  } else if (response && response.file) {
    imageUrl = response.file
  } else if (response && response.filename) {
    imageUrl = response.filename
  }

  if (imageUrl) {
    form.value.image_url = imageUrl
    imageUploadProgress.value = 100
    
    setTimeout(() => {
      imageUploadProgress.value = 0
      isImageUploading.value = false
      imageFileName.value = ''
      imageFileSize.value = 0
    }, 2000)
    
    ElMessage.success('图片上传成功')
  } else {
    console.error('无法从响应中提取URL，完整响应:', response)
    ElMessage.error('图片上传失败：未获取到图片URL')
    resetImageUploadState()
  }
}

const handleImageUploadError = (error) => {
  console.error('图片上传错误:', error)
  ElMessage.error('图片上传失败：' + (error.response?.data?.message || '未知错误'))
  resetImageUploadState()
}

const resetImageUploadState = () => {
  imageUploadProgress.value = 0
  isImageUploading.value = false
  isImageProcessing.value = false
  imageFileName.value = ''
  imageFileSize.value = 0
}

const removeImage = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这张图片吗？',
      '确认删除',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    form.value.image_url = ''
    ElMessage.success('图片已删除')
  } catch {
    // 用户取消删除
  }
}

// 拖拽处理函数
const handleImageDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isImageUploading.value && !isImageProcessing.value && !form.value.image_url) {
    isImageDragOver.value = true
  }
}

const handleImageDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isImageDragOver.value = false
  }
}

const handleImageDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleImageDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isImageDragOver.value = false
  
  if (isImageUploading.value || isImageProcessing.value || form.value.image_url) return
  
  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadImageFile(files[0])
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getImageUrl = (url) => {
  if (!url) {
    console.log('图片URL为空')
    return ''
  }
  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`
  console.log('生成的完整图片URL:', fullUrl)
  return fullUrl
}

const handleSubmit = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入轮播图标题')
    return
  }
  if (!form.value.image_url) {
    ElMessage.warning('请上传轮播图图片')
    return
  }

  try {
    const submitData = {
      ...form.value
    }

    if (isEdit.value) {
      await axios.put(`/banners/${form.value.id}`, submitData)
    } else {
      await axios.post('/banners', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    fetchBanners()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  fetchBanners()
})

// ============ 链接快捷选择逻辑 ============
function handleLinkTypeChange() {
  form.value.link_id = null
  form.value.original_artist_id = null
  linkOptions.value = []
  artistOptions.value = []
  if (form.value.link_type) {
    if (form.value.link_type === 'original') {
      loadArtistOptions()
    } else {
      loadLinkOptions()
    }
  }
}

async function onLinkSelectVisibleChange(visible) {
  if (!visible) return
  if (!form.value.link_type) return
  if (form.value.link_type === 'original') {
    if (!form.value.original_artist_id) return
    if (linkOptions.value.length === 0) await loadLinkOptions()
  } else if (linkOptions.value.length === 0) {
    await loadLinkOptions()
  }
}

async function loadLinkOptions() {
  if (!form.value.link_type) return
  linkOptionsLoading.value = true
  try {
    let items = []
    if (form.value.link_type === 'digital') {
      const res = await axios.get('/digital-artworks/admin', { params: { page: 1, pageSize: 50 } })
      items = Array.isArray(res) ? res : []
      linkOptions.value = items.map(it => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'rights') {
      const res = await axios.get('/rights', { params: { page: 1, limit: 50 } })
      // axios 实例已返回 data，rights 列表结构为 { data: [...], pagination: {...} }
      items = (res && Array.isArray(res.data)) ? res.data : (res && Array.isArray(res.data?.data)) ? res.data.data : (Array.isArray(res?.data) ? res.data : [])
      linkOptions.value = (items || []).map(it => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'original') {
      // 聚合分页，最多抓取 ORIGINAL_MAX_PAGES 页
      const aggregated = []
      for (let page = 1; page <= ORIGINAL_MAX_PAGES; page++) {
        const params = { page, pageSize: ORIGINAL_PAGE_SIZE }
        if (form.value.original_artist_id) params.artist_id = form.value.original_artist_id
        const res = await axios.get('/original-artworks', { params })
        const pageItems = res && Array.isArray(res.data) ? res.data : (res && Array.isArray(res.data?.data)) ? res.data.data : []
        if (pageItems.length === 0) break
        aggregated.push(...pageItems)
        // 如果这一页不足 pageSize，说明已到底
        if (pageItems.length < ORIGINAL_PAGE_SIZE) break
      }
      items = aggregated
      linkOptions.value = aggregated.map(it => ({ value: it.id, label: it.title }))
    } else if (form.value.link_type === 'artist') {
      const res = await axios.get('/artists')
      items = Array.isArray(res) ? res : (res && res.data && Array.isArray(res.data) ? res.data : [])
      linkOptions.value = items.map(it => ({ value: it.id, label: it.name }))
    }
  } catch (err) {
    console.error('加载链接选项失败:', err)
    ElMessage.error('加载链接选项失败')
  } finally {
    linkOptionsLoading.value = false
  }
}

async function loadArtistOptions() {
  artistOptionsLoading.value = true
  try {
    const res = await axios.get('/artists')
    const arr = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : [])
    artistOptions.value = arr.map(a => ({ value: a.id, label: a.name }))
  } catch (e) {
    console.error('加载艺术家失败:', e)
    ElMessage.error('加载艺术家失败')
  } finally {
    artistOptionsLoading.value = false
  }
}

async function handleOriginalArtistChange() {
  form.value.link_id = null
  linkOptions.value = []
  if (form.value.original_artist_id) {
    await loadLinkOptions()
  }
}

function applyComposedLink() {
  if (form.value.link_type && form.value.link_id) {
    const base = linkPathMap[form.value.link_type]
    form.value.link_url = `${base}?id=${form.value.link_id}`
  }
}

function tryParseExistingLink(url) {
  if (!url || typeof url !== 'string') return
  // 接受 original 的别名 artwork
  const match = url.match(/^\/pages\/(digital|rights|original|artist|artwork)\/detail\?id=(\d+)$/)
  if (match) {
    let type = match[1]
    if (type === 'artwork') type = 'original'
    const id = parseInt(match[2])
    form.value.link_type = type
    form.value.link_id = id
    // 预加载下拉选项，方便展示
    loadLinkOptions()
  } else {
    form.value.link_type = ''
    form.value.link_id = null
  }
}
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

/* 图片上传容器 */
.image-upload-container {
  width: 100%;
  max-width: 400px;
}

/* 图片预览 */
.image-preview {
  position: relative;
  width: 300px;
  height: 180px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.image-preview:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  opacity: 0;
  transition: opacity 0.3s ease;
  gap: 10px;
}

.image-preview:hover .image-overlay {
  opacity: 1;
}

.remove-btn {
  background: rgba(245, 108, 108, 0.9);
  border: none;
}

.remove-btn:hover {
  background: #f56c6c;
}

.replace-btn {
  background: rgba(64, 158, 255, 0.9);
  border: none;
}

.replace-btn:hover {
  background: #409eff;
}

/* 上传区域 */
.upload-zone {
  width: 300px;
  height: 180px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  background: #fafafa;
}

.upload-zone:hover {
  border-color: #409eff;
  background: #f0f9ff;
}

.upload-zone.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(64, 158, 255, 0.3);
}

.upload-zone.uploading {
  opacity: 0.7;
  pointer-events: none;
  border-color: #409eff;
  background: #f0f9ff;
}

.upload-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
}

.upload-icon {
  font-size: 48px;
  color: #8c939d;
  margin-bottom: 16px;
  transition: all 0.3s ease;
}

.upload-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.upload-text {
  text-align: center;
}

.upload-title {
  margin: 0 0 8px 0;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.upload-hint {
  margin: 0;
  color: #909399;
  font-size: 12px;
  line-height: 1.4;
}

/* 拖拽遮罩 */
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(64, 158, 255, 0.1);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #409eff;
  font-weight: bold;
  z-index: 10;
  border-radius: 8px;
}

.drag-icon {
  font-size: 48px;
  margin-bottom: 10px;
}

/* 上传进度 */
.upload-progress {
  margin-top: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-title {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.progress-percentage {
  font-size: 14px;
  font-weight: bold;
  color: #409eff;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.file-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.processing-hint {
  margin-top: 8px;
  text-align: center;
}

.processing-hint p {
  margin: 0;
  color: #909399;
  font-size: 12px;
  font-style: italic;
}

/* 上传成功提示 */
.upload-success {
  margin-top: 16px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .image-upload-container {
    max-width: 100%;
  }
  
  .image-preview,
  .upload-zone {
    width: 100%;
    max-width: 300px;
    height: 180px;
  }
}
</style> 