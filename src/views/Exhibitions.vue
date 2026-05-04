<template>
  <div class="exhibitions-container">
    <div v-if="!isDetailMode" class="header">
      <h2>展览管理</h2>
      <div class="header-actions">
        <el-button type="info" @click="fetchExhibitions" :loading="loadingList">刷新数据</el-button>
        <el-button type="primary" @click="openAddDialog">添加展览</el-button>
      </div>
    </div>

    <div v-else class="header">
      <h2>展览作品管理</h2>
      <div class="header-actions">
        <el-button @click="goBackToList">返回展览列表</el-button>
        <el-button type="info" @click="fetchDetail(exhibitionId)" :loading="loadingDetail">刷新详情</el-button>
      </div>
    </div>

    <!-- 列表模式 -->
    <div v-if="!isDetailMode">
      <el-table v-loading="loadingList" :data="exhibitions" style="width: 100%">
        <el-table-column label="封面" width="120">
          <template #default="{ row }">
            <el-image
              v-if="row.cover_image"
              style="width: 80px; height: 80px"
              :src="getImageUrl(row.cover_image)"
              fit="cover"
            />
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'published' ? 'success' : 'info'">
              {{ row.status === 'published' ? '已发布' : '草稿' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="开始时间" width="180">
          <template #default="{ row }">
            <span v-if="row.start_at">{{ row.start_at }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="结束时间" width="180">
          <template #default="{ row }">
            <span v-if="row.end_at">{{ row.end_at }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button type="success" size="small" @click="goToManageItems(row.id)">管理作品</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 详情模式 -->
    <div v-else>
      <el-card v-if="exhibitionDetail" shadow="hover" class="detail-card" style="margin-bottom: 16px">
        <template #header>
          <div class="card-header">
            <div>
              <div class="card-title">
                {{ exhibitionDetail.exhibition?.title || '未命名展览' }}
              </div>
              <div class="card-subtitle">
                <el-tag :type="exhibitionDetail.exhibition?.status === 'published' ? 'success' : 'info'">
                  {{ exhibitionDetail.exhibition?.status === 'published' ? '已发布' : '草稿' }}
                </el-tag>
                <span style="margin-left: 12px">
                  创建时间：{{ exhibitionDetail.exhibition?.created_at || '-' }}
                </span>
              </div>
            </div>
            <div class="card-actions">
              <el-button type="primary" size="small" @click="openEditDialogFromDetail">编辑展览</el-button>
            </div>
          </div>
        </template>

        <div class="detail-body">
          <div class="cover">
            <el-image
              v-if="exhibitionDetail.exhibition?.cover_image"
              style="width: 140px; height: 140px"
              :src="getImageUrl(exhibitionDetail.exhibition.cover_image)"
              fit="cover"
            />
            <div v-else class="cover-placeholder">无封面</div>
          </div>

          <div class="meta">
            <div><b>描述：</b>{{ exhibitionDetail.exhibition?.description || '-' }}</div>
            <div style="margin-top: 8px"><b>开始时间：</b>{{ exhibitionDetail.exhibition?.start_at || '-' }}</div>
            <div style="margin-top: 8px"><b>结束时间：</b>{{ exhibitionDetail.exhibition?.end_at || '-' }}</div>
            <div style="margin-top: 8px"><b>作品数：</b>{{ exhibitionDetail.items_total ?? exhibitionDetail.items?.length ?? 0 }}</div>
            <div style="margin-top: 8px">
              <b>现场图：</b>{{ exhibitionDetail.live_photos_total ?? exhibitionDetail.live_photos?.length ?? 0 }} 张
            </div>
          </div>
        </div>
      </el-card>

      <el-card v-if="exhibitionDetail" shadow="hover" class="live-photos-card" style="margin-bottom: 16px">
        <template #header>
          <div class="card-header">
            <span class="card-title">展览现场图</span>
            <span class="text-muted" style="font-weight: normal; margin-left: 8px">
              （{{ exhibitionDetail.live_photos?.length || 0 }} / {{ MAX_LIVE_PHOTOS }}）
            </span>
          </div>
        </template>
        <div class="images-upload-container">
          <div v-if="(exhibitionDetail.live_photos || []).length > 0" class="images-list">
            <div v-for="p in exhibitionDetail.live_photos" :key="p.id" class="image-item">
              <img :src="getImageUrl(p.image_url)" class="item-image" alt="现场图" />
              <div class="item-overlay">
                <el-button
                  type="danger"
                  size="small"
                  circle
                  class="remove-btn"
                  @click="confirmDeleteLivePhoto(p)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>

          <div
            v-if="(exhibitionDetail.live_photos?.length || 0) < MAX_LIVE_PHOTOS"
            class="add-image-btn"
            :class="{
              'drag-over': isLivePhotosDragOver,
              uploading: isLivePhotosUploading || isLivePhotosProcessing
            }"
            @click="triggerLivePhotosInput"
            @dragenter="handleLivePhotosDragEnter"
            @dragleave="handleLivePhotosDragLeave"
            @dragover="handleLivePhotosDragOver"
            @drop="handleLivePhotosDrop"
          >
            <el-icon class="add-icon" :class="{ spinning: isLivePhotosUploading || isLivePhotosProcessing }">
              <component :is="isLivePhotosUploading || isLivePhotosProcessing ? Loading : Plus" />
            </el-icon>
            <p class="add-text">添加现场图</p>
            <p class="add-hint">最多 {{ MAX_LIVE_PHOTOS }} 张，支持拖拽多选</p>
          </div>

          <input
            ref="livePhotosInput"
            type="file"
            accept="image/*"
            multiple
            style="display: none"
            @change="handleLivePhotosFileSelect"
          />

          <div v-if="isLivePhotosProcessing" class="live-photos-upload-progress">
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
              <span class="file-name">{{ livePhotosFileName }}</span>
              <span class="file-size">{{ formatFileSize(livePhotosFileSize) }}</span>
            </div>
            <div class="processing-hint">
              <p>正在将图片转换为 WebP 格式并压缩...</p>
            </div>
          </div>

          <div
            v-if="livePhotosUploadProgress > 0 && livePhotosUploadProgress < 100 && !isLivePhotosProcessing"
            class="live-photos-upload-progress"
          >
            <div class="progress-header">
              <span class="progress-title">上传进度</span>
              <span class="progress-percentage">{{ livePhotosUploadProgress }}%</span>
            </div>
            <el-progress
              :percentage="livePhotosUploadProgress"
              :stroke-width="6"
              :show-text="false"
              :color="progressColors"
            />
            <div class="progress-info">
              <span class="file-name">{{ livePhotosFileName }}</span>
              <span class="file-size">{{ formatFileSize(livePhotosFileSize) }}</span>
            </div>
          </div>

        </div>
      </el-card>

      <div class="items-actions" style="margin-bottom: 12px">
        <el-button type="primary" @click="openItemsDialog" :disabled="!exhibitionDetail">追加展览作品</el-button>
      </div>

      <el-table v-loading="loadingDetail" :data="exhibitionDetail?.items || []" style="width: 100%">
        <el-table-column label="排序" width="90" prop="sort_order" />
        <el-table-column label="作品类型" width="120">
          <template #default="{ row }">
            <el-tag :type="row.artwork_type === 'digital' ? 'warning' : 'info'">
              {{ row.artwork_type === 'digital' ? '数字' : '原作' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="图片" width="120">
          <template #default="{ row }">
            <el-image
              v-if="row.artwork?.image"
              style="width: 80px; height: 80px"
              :src="getImageUrl(row.artwork.image)"
              fit="cover"
            />
            <el-image
              v-else-if="row.artwork?.image_url"
              style="width: 80px; height: 80px"
              :src="getImageUrl(row.artwork.image_url)"
              fit="cover"
            />
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="标题/ID" min-width="220">
          <template #default="{ row }">
            <div class="item-title">
              <div style="font-weight: 600">{{ row.artwork?.title || '未知作品' }}</div>
              <div class="text-muted" style="margin-top: 4px">
                item_id: {{ row.id }} / artwork_id: {{ row.artwork?.id || '-' }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="关联艺术家" min-width="220">
          <template #default="{ row }">
            <div class="artists-wrap">
              <el-tag
                v-for="a in (row.artists || [])"
                :key="a.id"
                size="small"
                type="info"
                style="margin-right: 6px; margin-bottom: 6px"
              >
                {{ a.name }}
              </el-tag>
              <span v-if="!(row.artists || []).length" class="text-muted">未关联</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <div class="detail-item-actions">
              <el-button type="primary" size="small" @click="openEditArtistsDialog(row)">
                编辑艺术家
              </el-button>
              <el-button type="danger" size="small" @click="handleRemoveItem(row)">
                移除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 添加/编辑展览弹窗 -->
    <el-dialog
      v-model="exhibitionDialogVisible"
      :title="exhibitionDialogMode === 'add' ? '添加展览' : '编辑展览'"
      width="60%"
    >
      <el-form :model="exhibitionForm" label-width="120px">
        <el-form-item label="标题" required>
          <el-input v-model="exhibitionForm.title" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="exhibitionForm.description" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="封面图片">
          <el-upload
            class="avatar-uploader"
            :class="{ 'uploading': isCoverUploading }"
            :show-file-list="false"
            :before-upload="beforeCoverUpload"
            :http-request="customCoverUpload"
            :on-success="handleCoverUploadSuccess"
            :on-error="handleCoverUploadError"
            :drag="true"
            :accept="'image/*'"
            name="file"
            @dragenter="handleCoverDragEnter"
            @dragleave="handleCoverDragLeave"
            @dragover="handleCoverDragOver"
            @drop="handleCoverDrop"
          >
            <div
              class="upload-area"
              :class="{ 'drag-over': isCoverDragOver, 'uploading': isCoverUploading }"
            >
              <el-image
                v-if="exhibitionForm.cover_image"
                :src="getImageUrl(exhibitionForm.cover_image)"
                class="avatar"
                lazy
                fit="cover"
              />

              <div v-else class="upload-placeholder">
                <el-icon class="avatar-uploader-icon">
                  <Plus />
                </el-icon>
                <div class="upload-text">
                  <p>点击或拖拽图片到此处上传</p>
                  <p class="upload-hint">
                    支持 JPG、PNG、GIF 格式，自动转换为 WebP 格式并压缩至 5MB 以内
                  </p>
                </div>
              </div>
            </div>

            <div v-if="isCoverDragOver" class="drag-overlay">
              <el-icon class="drag-icon">
                <Upload />
              </el-icon>
              <p>释放鼠标上传图片</p>
            </div>
          </el-upload>

          <!-- 上传进度条 -->
          <div v-if="coverUploadProgress > 0" class="upload-progress">
            <el-progress
              :percentage="coverUploadProgress"
              :stroke-width="8"
              :show-text="true"
              :status="coverUploadProgress === 100 ? 'success' : ''"
            />
            <p class="progress-text">
              <span v-if="coverUploadProgress < 100">正在上传图片... {{ coverUploadProgress }}%</span>
              <span v-else class="success-text">上传完成！</span>
            </p>
          </div>

          <div style="margin-top: 8px">
            <el-button
              v-if="exhibitionForm.cover_image"
              type="danger"
              plain
              @click="removeCoverImage"
            >
              移除封面
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="exhibitionForm.status" placeholder="请选择状态">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始时间">
          <el-date-picker
            v-model="exhibitionForm.start_at"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择开始日期"
          />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker
            v-model="exhibitionForm.end_at"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择结束日期"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="exhibitionDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitExhibition" :loading="savingExhibition">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 追加/替换展览作品弹窗 -->
    <el-dialog
      v-model="itemsDialogVisible"
      title="追加展览作品"
      width="72%"
    >
      <div class="items-dialog-body">
        <el-form :model="itemDraft" label-width="120px">
          <el-form-item label="作品类型">
            <el-select v-model="itemDraft.artwork_type" style="width: 160px" @change="handleArtworkTypeChange">
              <el-option label="原作" value="original" />
              <el-option label="数字" value="digital" />
            </el-select>
          </el-form-item>

          <el-form-item label="选择作品（原作）" v-if="itemDraft.artwork_type === 'original'">
            <el-select
              v-model="itemDraft.artwork_id"
              filterable
              placeholder="请选择 original_artworks"
              style="width: 520px"
            >
              <el-option
                v-for="a in originalArtworkOptions"
                :key="a.id"
                :label="`${a.title} (${a.id})`"
                :value="a.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="选择作品（数字）" v-else>
            <el-select
              v-model="itemDraft.artwork_id"
              filterable
              placeholder="请选择 digital_artworks_external"
              style="width: 520px"
            >
              <el-option
                v-for="a in digitalArtworkOptions"
                :key="a.id"
                :label="`${a.title} (${a.id})`"
                :value="a.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="排序 sort_order">
            <el-input-number v-model="itemDraft.sort_order" :min="1" :step="1" />
          </el-form-item>

          <el-form-item label="关联艺术家（可选）">
            <el-select
              v-model="itemDraft.artists"
              multiple
              collapse-tags
              filterable
              placeholder="不选则自动使用该作品自带 artist_id"
              style="width: 520px"
            >
              <el-option
                v-for="a in artistsOptions"
                :key="a.id"
                :label="a.name"
                :value="a.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" @click="addDraftItem" :disabled="!itemDraft.artwork_id">
              加入待提交列表
            </el-button>
          </el-form-item>
        </el-form>

        <div style="margin-top: 16px">
          <div class="text-muted" style="margin-bottom: 10px">待提交 items（将作为一次请求提交）</div>
          <el-table :data="pendingItems" style="width: 100%">
            <el-table-column label="排序" width="180">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.sort_order"
                  :min="1"
                  :step="1"
                  controls-position="right"
                  style="width: 160px"
                />
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="row.artwork_type === 'digital' ? 'warning' : 'info'">
                  {{ row.artwork_type === 'digital' ? '数字' : '原作' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="作品" min-width="320">
              <template #default="{ row }">
                <div class="pending-item-artwork">
                  <div style="font-weight: 600">{{ getPendingArtworkTitle(row) }}</div>
                  <div class="text-muted" style="margin-top: 4px">
                    artwork_id: {{ row.artwork_id }}
                  </div>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="关联艺术家" min-width="280">
              <template #default="{ row }">
                <span v-if="row.artists && row.artists.length">
                  {{ getPendingArtistNames(row.artists).join(', ') }}
                </span>
                <span v-else class="text-muted">自动匹配</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button type="danger" size="small" @click="pendingItems.splice($index, 1)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="itemsDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitItems" :loading="savingItems" :disabled="pendingItems.length === 0">
            提交
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 编辑某个展览作品的艺术家弹窗 -->
    <el-dialog v-model="editArtistsDialogVisible" title="编辑作品-艺术家关联" width="50%">
      <el-form>
        <div class="text-muted">item_id: {{ editArtistsItemId }}</div>
        <el-form-item style="margin-top: 12px">
          <el-select
            v-model="editArtistsDraftArtistIds"
            multiple
            collapse-tags
            filterable
            placeholder="选择艺术家"
            style="width: 100%"
          >
            <el-option v-for="a in artistsOptions" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="editArtistsDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitArtists" :loading="savingArtists">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Delete, Loading } from '@element-plus/icons-vue'
import { uploadImageToWebpLimit5MB } from '../utils/image'

const route = useRoute()
const router = useRouter()

const loadingList = ref(false)
const loadingDetail = ref(false)
const exhibitions = ref([])
const exhibitionDetail = ref(null)

const savingExhibition = ref(false)
const savingItems = ref(false)
const savingArtists = ref(false)

const livePhotosInput = ref(null)
const isLivePhotosDragOver = ref(false)
const livePhotosUploadProgress = ref(0)
const isLivePhotosUploading = ref(false)
const isLivePhotosProcessing = ref(false)
const livePhotosFileName = ref('')
const livePhotosFileSize = ref(0)

const progressColors = [
  { color: '#f56c6c', percentage: 20 },
  { color: '#e6a23c', percentage: 40 },
  { color: '#5cb87a', percentage: 60 },
  { color: '#1989fa', percentage: 80 },
  { color: '#6f7ad3', percentage: 100 }
]
const isCoverUploading = ref(false)
const coverUploadProgress = ref(0)
const isCoverDragOver = ref(false)

const getImageUrl = (url) => {
  if (!url) return ''
  if (isOssPublicUrl(url)) return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const isDetailMode = computed(() => !!route.params.id)
const exhibitionId = computed(() => route.params.id ? Number(route.params.id) : null)

// 列表/编辑展览表单
const exhibitionDialogVisible = ref(false)
const exhibitionDialogMode = ref('add') // add | edit
const exhibitionForm = reactive({
  id: null,
  title: '',
  description: '',
  cover_image: '',
  status: 'draft',
  start_at: '',
  end_at: ''
})

function toDateTimeInputValue(v) {
  if (!v) return ''
  // MySQL 返回一般是 "YYYY-MM-DD HH:mm:ss"
  // 日期选择器只需要 YYYY-MM-DD，因此只取前 10 位
  if (typeof v === 'string') return v.slice(0, 10)
  return String(v).slice(0, 10)
}

function resetExhibitionForm() {
  exhibitionForm.id = null
  exhibitionForm.title = ''
  exhibitionForm.description = ''
  exhibitionForm.cover_image = ''
  exhibitionForm.status = 'draft'
  exhibitionForm.start_at = ''
  exhibitionForm.end_at = ''
}

async function beforeCoverUpload(file) {
  // 使用同项目原图上传逻辑：压缩为 webp + 5MB 限制
  const isImage = file?.type && file.type.startsWith('image/')
  if (!isImage) {
    ElMessage.error('只能上传图片文件！')
    return false
  }

  coverUploadProgress.value = 0
  isCoverDragOver.value = false
  isCoverUploading.value = true

  const processedFile = await uploadImageToWebpLimit5MB(file)
  if (!processedFile) {
    isCoverUploading.value = false
    coverUploadProgress.value = 0
    return false
  }

  return Promise.resolve(processedFile)
}

const customCoverUpload = async (options) => {
  const { onSuccess, onError, file, onProgress } = options
  const formData = new FormData()
  formData.append('file', file)

  try {
    const resp = await axios.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          coverUploadProgress.value = percent
          onProgress && onProgress({ percent })
        } else {
          // 没有 total 时模拟一下进度，避免 UI 卡住
          coverUploadProgress.value = Math.min(coverUploadProgress.value + 10, 90)
          onProgress && onProgress({ percent: coverUploadProgress.value })
        }
      }
    })

    coverUploadProgress.value = 100
    onSuccess(resp)
    return resp
  } catch (err) {
    onError(err)
    throw err
  }
}

function extractUploadedUrl(result) {
  let url = ''
  if (result && result.url) url = result.url
  else if (result?.data?.url) url = result.data.url
  else if (typeof result?.data === 'string') url = result.data
  else if (typeof result === 'string') url = result
  else if (result?.file) url = result.file
  else if (result?.filename) url = result.filename
  else if (result?.path) url = result.path
  return url
}

function handleCoverUploadSuccess(response) {
  const url = extractUploadedUrl(response)
  if (url) {
    exhibitionForm.cover_image = url
    ElMessage.success('封面上传成功')
  } else {
    ElMessage.error('封面上传失败：未获取到图片URL')
  }

  isCoverUploading.value = false
  setTimeout(() => {
    coverUploadProgress.value = 0
  }, 1000)
}

function handleCoverUploadError(err) {
  console.error('cover upload error:', err)
  isCoverUploading.value = false
  coverUploadProgress.value = 0
  ElMessage.error('封面上传失败')
}

function removeCoverImage() {
  exhibitionForm.cover_image = ''
  coverUploadProgress.value = 0
  isCoverUploading.value = false
}

const MAX_LIVE_PHOTOS = 50

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function resetLivePhotosUploadState() {
  livePhotosUploadProgress.value = 0
  isLivePhotosUploading.value = false
  isLivePhotosProcessing.value = false
  livePhotosFileName.value = ''
  livePhotosFileSize.value = 0
}

function triggerLivePhotosInput() {
  if (!isLivePhotosUploading.value && !isLivePhotosProcessing.value) {
    livePhotosInput.value?.click()
  }
}

function handleLivePhotosFileSelect(event) {
  const files = Array.from(event.target.files || [])
  if (files.length > 0) {
    uploadLivePhotosFiles(files)
  }
  event.target.value = ''
}

async function uploadLivePhotosFiles(files) {
  if (!exhibitionId.value || !exhibitionDetail.value) return

  const imageFiles = files.filter((f) => f.type && f.type.startsWith('image/'))
  if (!imageFiles.length) {
    ElMessage.warning('请选择图片文件')
    return
  }

  const current = exhibitionDetail.value.live_photos?.length || 0
  if (current + imageFiles.length > MAX_LIVE_PHOTOS) {
    ElMessage.warning(
      `现场图最多 ${MAX_LIVE_PHOTOS} 张，当前 ${current} 张，还可添加 ${MAX_LIVE_PHOTOS - current} 张`
    )
    return
  }

  isLivePhotosUploading.value = true
  isLivePhotosProcessing.value = true

  const urls = []

  for (const file of imageFiles) {
    try {
      const processedFile = await uploadImageToWebpLimit5MB(file)
      if (!processedFile) {
        continue
      }

      isLivePhotosProcessing.value = false
      livePhotosFileName.value = processedFile.name
      livePhotosFileSize.value = processedFile.size
      livePhotosUploadProgress.value = 0

      const formData = new FormData()
      formData.append('file', processedFile)

      const response = await axios.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            livePhotosUploadProgress.value = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          } else {
            livePhotosUploadProgress.value = Math.min(livePhotosUploadProgress.value + 10, 90)
          }
        }
      })

      const imageUrl = extractUploadedUrl(response)
      if (imageUrl) {
        urls.push(imageUrl)
        livePhotosUploadProgress.value = 100
        setTimeout(() => {
          livePhotosUploadProgress.value = 0
        }, 1500)
      } else {
        ElMessage.error('图片上传失败：未获取到图片URL')
      }
    } catch (error) {
      console.error('现场图上传错误:', error)
      ElMessage.error(error?.response?.data?.message || error?.response?.data?.error || '图片上传失败')
    }
  }

  if (urls.length) {
    try {
      await axios.post(`/exhibitions/${exhibitionId.value}/live-photos`, { images: urls })
      ElMessage.success(`已追加 ${urls.length} 张现场图`)
      await fetchDetail(exhibitionId.value)
    } catch (e) {
      console.error('live photos save failed:', e)
      ElMessage.error(e?.response?.data?.error || '保存现场图失败')
    }
  }

  resetLivePhotosUploadState()
}

function handleLivePhotosDragEnter(e) {
  e.preventDefault()
  e.stopPropagation()
  const n = exhibitionDetail.value?.live_photos?.length || 0
  if (!isLivePhotosUploading.value && !isLivePhotosProcessing.value && n < MAX_LIVE_PHOTOS) {
    isLivePhotosDragOver.value = true
  }
}

function handleLivePhotosDragLeave(e) {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isLivePhotosDragOver.value = false
  }
}

function handleLivePhotosDragOver(e) {
  e.preventDefault()
  e.stopPropagation()
}

function handleLivePhotosDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  isLivePhotosDragOver.value = false

  const n = exhibitionDetail.value?.live_photos?.length || 0
  if (isLivePhotosUploading.value || isLivePhotosProcessing.value || n >= MAX_LIVE_PHOTOS) return

  const dropped = Array.from(e.dataTransfer?.files || [])
  if (dropped.length > 0) {
    uploadLivePhotosFiles(dropped)
  }
}

async function confirmDeleteLivePhoto(p) {
  if (!exhibitionId.value || !p?.id) return
  try {
    await ElMessageBox.confirm('确定删除这张现场图？', '确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await axios.delete(`/exhibitions/${exhibitionId.value}/live-photos/${p.id}`)
    ElMessage.success('已删除')
    await fetchDetail(exhibitionId.value)
  } catch (e) {
    console.error('delete live photo failed:', e)
    ElMessage.error(e?.response?.data?.error || '删除失败')
  }
}

// 监听拖拽状态（用于 UI 高亮）
function handleCoverDragEnter(e) {
  e.preventDefault()
  e.stopPropagation()
  isCoverDragOver.value = true
}

function handleCoverDragLeave(e) {
  e.preventDefault()
  e.stopPropagation()
  isCoverDragOver.value = false
}

function handleCoverDragOver(e) {
  e.preventDefault()
  e.stopPropagation()
  isCoverDragOver.value = true
}

function handleCoverDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  isCoverDragOver.value = false
}

function openAddDialog() {
  resetExhibitionForm()
  exhibitionDialogMode.value = 'add'
  exhibitionDialogVisible.value = true
}

async function openEditDialog(row) {
  resetExhibitionForm()
  exhibitionDialogMode.value = 'edit'

  // 列表接口不返回 description，直接编辑可能把描述覆盖为空，所以编辑时补拉详情
  let ex = row
  try {
    if (row?.id) {
      const detailRes = await axios.get(`/exhibitions/${row.id}`)
      ex = detailRes?.exhibition || row
    }
  } catch (_) {
    ex = row
  }

  exhibitionForm.id = ex?.id || row.id
  exhibitionForm.title = ex?.title || ''
  exhibitionForm.description = ex?.description || ''
  exhibitionForm.cover_image = ex?.cover_image || ''
  exhibitionForm.status = ex?.status || 'draft'
  exhibitionForm.start_at = toDateTimeInputValue(ex?.start_at)
  exhibitionForm.end_at = toDateTimeInputValue(ex?.end_at)
  exhibitionDialogVisible.value = true
}

function openEditDialogFromDetail() {
  if (!exhibitionDetail.value?.exhibition) return
  openEditDialog(exhibitionDetail.value.exhibition)
}

async function submitExhibition() {
  if (!exhibitionForm.title || !exhibitionForm.title.trim()) {
    ElMessage.error('title 不能为空')
    return
  }

  savingExhibition.value = true
  try {
    const payload = {
      title: exhibitionForm.title.trim(),
      description: exhibitionForm.description || null,
      cover_image: exhibitionForm.cover_image || null,
      status: exhibitionForm.status || 'draft',
      start_at: exhibitionForm.start_at ? `${exhibitionForm.start_at}T00:00:00` : null,
      end_at: exhibitionForm.end_at ? `${exhibitionForm.end_at}T00:00:00` : null
    }

    if (exhibitionDialogMode.value === 'add') {
      await axios.post('/exhibitions', payload)
      ElMessage.success('展览创建成功')
    } else {
      const id = exhibitionForm.id
      if (!id) throw new Error('Missing exhibition id')
      await axios.put(`/exhibitions/${id}`, payload)
      ElMessage.success('展览更新成功')
    }

    exhibitionDialogVisible.value = false
    if (isDetailMode.value) {
      await fetchDetail(exhibitionId.value)
    } else {
      await fetchExhibitions()
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || e.message || '操作失败')
  } finally {
    savingExhibition.value = false
  }
}

async function fetchExhibitions() {
  loadingList.value = true
  try {
    const res = await axios.get('/exhibitions?page=1&pageSize=100')
    // axios 已返回 response.data
    const list = res?.data && Array.isArray(res.data) ? res.data : []
    exhibitions.value = list
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '获取展览列表失败')
  } finally {
    loadingList.value = false
  }
}

// ---------------------------
// 详情模式：展览作品 & 关联艺术家
// ---------------------------

const artistsOptions = ref([])
const originalArtworkOptions = ref([])
const digitalArtworkOptions = ref([])

async function fetchArtists() {
  const res = await axios.get('/artists')
  if (Array.isArray(res)) artistsOptions.value = res
}

async function fetchOriginalArtworksOptions() {
  const res = await axios.get('/original-artworks?page=1&pageSize=1000')
  const list = res?.data && Array.isArray(res.data) ? res.data : []
  originalArtworkOptions.value = list.map((a) => ({
    id: a.id,
    title: a.title,
    image: a.image,
    artist_name: a.artist_name
  }))
}

async function fetchDigitalArtworksOptions() {
  const res = await axios.get('/digital-artworks?page=1&pageSize=1000')
  const list = res?.data && Array.isArray(res.data) ? res.data : []
  digitalArtworkOptions.value = list.map((a) => ({
    id: a.id,
    title: a.title,
    image_url: a.image_url,
    artist_name: a.artist?.name || a.artist_name
  }))
}

function getArtistNameById(artistId) {
  if (!artistId) return ''
  const sid = String(artistId)
  const found = (artistsOptions.value || []).find((a) => String(a.id) === sid)
  return found?.name || ''
}

function getPendingArtistNames(artistIds) {
  if (!Array.isArray(artistIds) || artistIds.length === 0) return []
  return artistIds.map((id) => {
    const name = getArtistNameById(id)
    return name || String(id)
  })
}

function getPendingArtworkTitle(row) {
  if (!row) return '-'
  const aid = row.artwork_id
  const type = row.artwork_type
  if (type === 'original') {
    const sid = String(aid)
    const found = (originalArtworkOptions.value || []).find((a) => String(a.id) === sid)
    return found?.title || sid
  }
  if (type === 'digital') {
    const sid = String(aid)
    const found = (digitalArtworkOptions.value || []).find((a) => String(a.id) === sid)
    return found?.title || sid
  }
  return String(aid || '-')
}

async function ensureOptionsLoaded() {
  // 简单加载：避免重复请求
  if (artistsOptions.value.length && originalArtworkOptions.value.length && digitalArtworkOptions.value.length) return
  await Promise.all([fetchArtists(), fetchOriginalArtworksOptions(), fetchDigitalArtworksOptions()])
}

async function fetchDetail(id) {
  if (!id) return
  loadingDetail.value = true
  try {
    const res = await axios.get(`/exhibitions/${id}`)
    exhibitionDetail.value = res
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '获取展览详情失败')
  } finally {
    loadingDetail.value = false
  }
}

function goToManageItems(id) {
  router.push(`/exhibitions/${id}`)
}

function goBackToList() {
  router.push('/exhibitions')
}

// 子页面里切换路由参数时刷新
watch(
  () => route.params.id,
  async (newVal) => {
    if (newVal) {
      const id = Number(newVal)
      await fetchDetail(id)
      await ensureOptionsLoaded()
    } else {
      exhibitionDetail.value = null
      await fetchExhibitions()
    }
  },
  { immediate: false }
)

onMounted(async () => {
  if (isDetailMode.value) {
    await fetchDetail(exhibitionId.value)
    await ensureOptionsLoaded()
  } else {
    await fetchExhibitions()
  }
})

// ---------------------------
// items 对话框：追加/替换
// ---------------------------

const itemsDialogVisible = ref(false)
// 目前仅保留追加模式
// const itemsDialogMode = ref('append') // append | replace

const itemDraft = reactive({
  artwork_type: 'original',
  artwork_id: null,
  sort_order: 1,
  artists: []
})

const pendingItems = ref([])

function handleArtworkTypeChange() {
  itemDraft.artwork_id = null
  // sort_order 由用户自己调整，默认按当前 pendingItems 继续
  const existingLen = (exhibitionDetail.value?.items?.length || 0)
  const base = existingLen
  itemDraft.sort_order = base + pendingItems.value.length + 1
}

function openItemsDialog() {
  itemsDialogVisible.value = true
  pendingItems.value = []
  itemDraft.artwork_type = 'original'
  itemDraft.artwork_id = null
  itemDraft.artists = []
  const existingLen = (exhibitionDetail.value?.items?.length || 0)
  itemDraft.sort_order = existingLen + 1
}

function addDraftItem() {
  const artworkId = itemDraft.artwork_id
  if (!artworkId) {
    ElMessage.error('请选择 artwork_id')
    return
  }
  const artists = Array.isArray(itemDraft.artists) ? itemDraft.artists.slice() : []

  pendingItems.value.push({
    artwork_type: itemDraft.artwork_type,
    artwork_id: itemDraft.artwork_id,
    sort_order: itemDraft.sort_order,
    artists
  })

  // 便于继续添加下一个
  const existingLen = (exhibitionDetail.value?.items?.length || 0)
  itemDraft.sort_order = existingLen + pendingItems.value.length + 1
  itemDraft.artwork_id = null
  itemDraft.artists = []
}

async function submitItems() {
  if (!exhibitionId.value) return
  if (!pendingItems.value.length) return

  savingItems.value = true
  try {
    const payload = { items: pendingItems.value }
    await axios.post(`/exhibitions/${exhibitionId.value}/items`, payload)
    ElMessage.success('追加成功')
    itemsDialogVisible.value = false
    await fetchDetail(exhibitionId.value)
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '提交 items 失败')
  } finally {
    savingItems.value = false
  }
}

// ---------------------------
// 编辑某个 item 的 artists 关联
// ---------------------------
const editArtistsDialogVisible = ref(false)
const editArtistsItemId = ref(null)
const editArtistsDraftArtistIds = ref([])

function openEditArtistsDialog(row) {
  editArtistsItemId.value = row.id
  editArtistsDraftArtistIds.value = (row.artists || []).map((a) => a.id)
  editArtistsDialogVisible.value = true
}

async function handleRemoveItem(row) {
  if (!exhibitionId.value || !row?.id) return

  try {
    await ElMessageBox.confirm('确定移除该展览作品吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await axios.delete(`/exhibitions/${exhibitionId.value}/items/${row.id}`)
    ElMessage.success('移除成功')
    await fetchDetail(exhibitionId.value)
  } catch (e) {
    // cancel 时会抛异常，这里静默
    if (e && e !== 'cancel') {
      ElMessage.error(e?.response?.data?.error || '移除失败')
    }
  }
}

async function submitArtists() {
  if (!exhibitionId.value || !editArtistsItemId.value) return
  savingArtists.value = true
  try {
    await axios.put(
      `/exhibitions/${exhibitionId.value}/items/${editArtistsItemId.value}/artists`,
      { artist_ids: editArtistsDraftArtistIds.value }
    )
    ElMessage.success('艺术家关联已更新')
    editArtistsDialogVisible.value = false
    await fetchDetail(exhibitionId.value)
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    savingArtists.value = false
  }
}
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.text-muted {
  color: #909399;
}

.detail-card .card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-card .card-title {
  font-size: 18px;
  font-weight: 600;
}

.detail-card .card-subtitle {
  margin-top: 6px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.detail-card .detail-body {
  display: flex;
  gap: 20px;
}

.detail-card .cover {
  width: 160px;
}

.cover-placeholder {
  width: 140px;
  height: 140px;
  border: 1px dashed #dcdfe6;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
}

.artists-wrap {
  display: flex;
  flex-wrap: wrap;
}

.items-dialog-body {
  min-height: 240px;
}

.detail-item-actions {
  display: flex;
  gap: 8px;
}

/* 封面上传：复用其他页面的上传 UI 样式（简化子集） */
.avatar-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 200px;
  height: 200px;
  transition: all 0.3s ease;
  margin-bottom: 8px;
}

.avatar-uploader:hover {
  border-color: #409eff;
}

.avatar-uploader.uploading {
  opacity: 0.7;
  pointer-events: none;
}

.avatar-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 200px;
  height: 200px;
  text-align: center;
  line-height: 200px;
}

.avatar {
  width: 200px;
  height: 200px;
  display: block;
  object-fit: cover;
}

.upload-area {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #f5f7fa;
  border: 2px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
}

.upload-area.drag-over {
  border-color: #409eff;
  background-color: #ecf5ff;
  transform: scale(1.02);
  box-shadow: 0 0 10px rgba(64, 158, 255, 0.3);
}

.upload-area.uploading {
  background-color: #f0f9ff;
  border-color: #409eff;
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(64, 158, 255, 0.1);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #409eff;
  font-weight: bold;
  z-index: 10;
  border-radius: 6px;
}

.drag-icon {
  font-size: 48px;
  margin-bottom: 10px;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
}

.upload-text {
  text-align: center;
  color: #606266;
  margin-top: 10px;
}

.upload-text p {
  margin: 5px 0;
}

.upload-hint {
  font-size: 12px;
  color: #909399;
}

.upload-progress {
  margin-top: 15px;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e9ecef;
  width: 200px;
}

.progress-text {
  margin: 10px 0 0 0;
  text-align: center;
  color: #606266;
  font-size: 14px;
}

.success-text {
  color: #67c23a;
  font-weight: bold;
}

.live-photos-card .card-header {
  display: flex;
  align-items: center;
}

/* 与商家管理「商家图片」一致的多图上传样式 */
.live-photos-card .images-upload-container {
  width: 100%;
}

.live-photos-card .images-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.live-photos-card .image-item {
  position: relative;
  width: 120px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.live-photos-card .image-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.live-photos-card .item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.live-photos-card .item-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.live-photos-card .image-item:hover .item-overlay {
  opacity: 1;
}

.live-photos-card .add-image-btn {
  width: 120px;
  height: 120px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: #fafafa;
}

.live-photos-card .add-image-btn:hover {
  border-color: #409eff;
  background: #f0f9ff;
}

.live-photos-card .add-image-btn.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(64, 158, 255, 0.3);
}

.live-photos-card .add-image-btn.uploading {
  opacity: 0.7;
  pointer-events: none;
  border-color: #409eff;
  background: #f0f9ff;
}

.live-photos-card .add-icon {
  font-size: 32px;
  color: #8c939d;
  margin-bottom: 8px;
  transition: all 0.3s ease;
}

.live-photos-card .add-icon.spinning {
  animation: live-photos-spin 1s linear infinite;
}

@keyframes live-photos-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.live-photos-card .add-text {
  margin: 0 0 4px 0;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.live-photos-card .add-hint {
  margin: 0;
  color: #909399;
  font-size: 12px;
  text-align: center;
  padding: 0 6px;
}

.live-photos-card .live-photos-upload-progress {
  margin-top: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.live-photos-card .progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.live-photos-card .progress-title {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.live-photos-card .progress-percentage {
  font-size: 14px;
  font-weight: bold;
  color: #409eff;
}

.live-photos-card .progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.live-photos-card .file-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-photos-card .processing-hint {
  margin-top: 8px;
  text-align: center;
}

.live-photos-card .processing-hint p {
  margin: 0;
  color: #909399;
  font-size: 12px;
  font-style: italic;
}
</style>

