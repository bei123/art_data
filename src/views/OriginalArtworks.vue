<template>
  <div class="artworks-container">
    <div class="header">
      <h2>艺术品管理</h2>
      <div class="header-buttons">
        <el-button type="info" @click="refreshData" :loading="loading">刷新数据</el-button>
        <el-button type="primary" @click="showAddDialog">添加艺术品</el-button>
      </div>
    </div>

    <!-- 搜索区域 -->
    <div class="search-container">
      <el-row :gutter="20">
        <el-col :span="8">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索艺术品标题、描述或艺术家名称"
            clearable
            @keyup.enter="handleSearch"
            @clear="handleClearSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-col>
        <el-col :span="4">
          <el-button type="primary" @click="handleSearch" :loading="loading">
            搜索
          </el-button>
        </el-col>
        <el-col :span="4">
          <el-button @click="handleClearSearch" v-if="searchKeyword">
            清除搜索
          </el-button>
        </el-col>
      </el-row>
      
      <!-- 搜索结果提示 -->
      <div v-if="isSearchMode && !loading" class="search-result-tip">
        <el-alert
          :title="`搜索'${searchKeyword}'的结果：共找到 ${pagination.total} 条记录`"
          type="info"
          :closable="false"
          show-icon
        />
      </div>
    </div>

    <el-table 
      v-loading="loading"
      :data="artworks" 
      style="width: 100%"
    >
      <el-table-column prop="title" label="标题" />
             <el-table-column label="图片" width="120">
         <template #default="{ row }">
           <el-image 
             :src="row.image" 
             :preview-src-list="[row.image]"
             fit="cover"
             lazy
             :initial-index="0"
             style="width: 80px; height: 80px"
           >
             <template #placeholder>
               <div class="image-placeholder">
                 <el-icon><Picture /></el-icon>
               </div>
             </template>
             <template #error>
               <div class="image-error">
                 <el-icon><Picture /></el-icon>
               </div>
             </template>
           </el-image>
         </template>
       </el-table-column>
      <el-table-column prop="artist_name" label="艺术家" />
      <el-table-column prop="year" label="年份" width="100" />
      <el-table-column label="价格" width="200">
        <template #default="{ row }">
          <div v-if="row.discount_price && row.discount_price < row.original_price">
            <span class="original-price">¥{{ row.original_price }}</span>
            <span class="discount-price">¥{{ row.discount_price }}</span>
          </div>
          <span v-else>¥{{ row.original_price }}</span>
        </template>
      </el-table-column>
      <el-table-column label="库存/销量" width="150">
        <template #default="{ row }">
          <div>库存: {{ row.stock }}</div>
          <div>销量: {{ row.sales }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.is_on_sale ? 'success' : 'info'">
            {{ row.is_on_sale ? '在售' : '下架' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="editArtwork(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="deleteArtwork(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页组件 -->
    <div class="pagination-container">
      <div class="pagination-info" v-if="isSearchMode">
        <span>搜索结果：共 {{ pagination.total }} 条</span>
      </div>
      <el-pagination
        :current-page="pagination.page"
        :page-size="pagination.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
        @update:current-page="(val) => pagination.page = val"
        @update:page-size="(val) => pagination.pageSize = val"
      />
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog 
      :title="dialogType === 'add' ? '添加艺术品' : '编辑艺术品'" 
      v-model="dialogVisible"
      width="60%"
    >
      <el-form 
        :model="form" 
        :rules="rules"
        ref="formRef"
        label-width="100px"
      >
        <el-form-item label="标题" required>
          <el-input v-model="form.title" />
        </el-form-item>
                 <el-form-item label="图片" required>
                       <el-upload
              class="avatar-uploader"
              :class="{ 'uploading': isUploading }"
              :action="`${baseUrl}/api/upload`"
              :show-file-list="false"
              :on-success="handleUploadSuccess"
              :before-upload="beforeUpload"
              :drag="true"
              :accept="'image/*'"
              name="file"
              :http-request="customUpload"
              @dragenter="handleDragEnter"
              @dragleave="handleDragLeave"
              @dragover="handleDragOver"
              @drop="handleDrop"
            >
             <div class="upload-area" :class="{ 'drag-over': isDragOver, 'uploading': isUploading }">
               <el-image 
                 v-if="form.image" 
                 :src="form.image" 
                 class="avatar"
                 lazy
                 fit="cover"
               >
                 <template #placeholder>
                   <div class="upload-placeholder">
                     <el-icon><Picture /></el-icon>
                   </div>
                 </template>
                 <template #error>
                   <div class="upload-error">
                     <el-icon><Picture /></el-icon>
                   </div>
                 </template>
               </el-image>
               <div v-else class="upload-placeholder">
                 <el-icon class="avatar-uploader-icon"><Plus /></el-icon>
                 <div class="upload-text">
                   <p>点击或拖拽图片到此处上传</p>
                   <p class="upload-hint">支持 JPG、PNG、GIF 格式，文件大小不超过 50MB</p>
                 </div>
               </div>
             </div>
             <div v-if="isDragOver" class="drag-overlay">
               <el-icon class="drag-icon"><Upload /></el-icon>
               <p>释放鼠标上传图片</p>
             </div>
           </el-upload>
           
           <!-- 上传进度条 -->
           <div v-if="uploadProgress > 0" class="upload-progress">
             <el-progress 
               :percentage="uploadProgress" 
               :stroke-width="8"
               :show-text="true"
               :status="uploadProgress === 100 ? 'success' : ''"
             />
             <p class="progress-text">
               <span v-if="uploadProgress < 100">正在上传图片... {{ uploadProgress }}%</span>
               <span v-else class="success-text">上传完成！</span>
             </p>
           </div>
         </el-form-item>

                 <el-form-item label="详情富文本" style="width: 100%">
           <Toolbar :editor="editorRef" style="width: 100%" />
           <Editor
             v-model="longDescriptionHtml"
             :defaultConfig="{ 
               placeholder: '请输入内容...', 
               ...editorConfig,
               // 优化图片显示
               EXTEND_CONF: {
                 ...editorConfig.EXTEND_CONF,
                 // 图片懒加载配置
                 imageLazyLoad: true,
                 imageLazyLoadPlaceholder: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEyIiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+5Zu+54mHPC90ZXh0Pjwvc3ZnPg==',
                 // 图片加载失败处理
                 imageLoadError: (img) => {
                   img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2ZlZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEyIiBmaWxsPSIjZjU2YzZjIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+5Zu+54mH5aSx6KSlPC90ZXh0Pjwvc3ZnPg==';
                   img.alt = '图片加载失败';
                 }
               }
             }"
             mode="default"
             style="width: 100%; min-width: 400px; height: 300px; border: 1px solid #ccc"
             @onCreated="handleEditorCreated"
           />
         </el-form-item>
        <el-form-item label="艺术家" required>
          <el-select v-model="form.artist_id" filterable placeholder="请选择艺术家">
            <el-option
              v-for="artist in artistOptions"
              :key="artist.id"
              :label="artist.name"
              :value="artist.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="年份">
          <el-input v-model="form.year" />
        </el-form-item>
        <el-divider>价格和库存信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="原价" prop="original_price">
              <el-input-number 
                v-model="form.original_price" 
                :min="0" 
                :precision="2" 
                :step="100"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="折扣价" prop="discount_price">
              <el-input-number 
                v-model="form.discount_price" 
                :min="0" 
                :precision="2" 
                :step="100"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="库存" prop="stock">
              <el-input-number 
                v-model="form.stock" 
                :min="0" 
                :precision="0" 
                :step="1"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="销量" prop="sales">
              <el-input-number 
                v-model="form.sales" 
                :min="0" 
                :precision="0" 
                :step="1"
                style="width: 100%"
                :disabled="true"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="状态" prop="is_on_sale">
          <el-switch
            v-model="form.is_on_sale"
            :active-value="1"
            :inactive-value="0"
            active-text="在售"
            inactive-text="下架"
          />
        </el-form-item>

        <el-form-item label="描述">
          <el-input type="textarea" v-model="form.description" rows="4" />
        </el-form-item>

        <el-divider>收藏信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="证书编号">
              <el-input v-model="form.collection_number" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="作品尺寸">
              <el-input v-model="form.collection_size" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="作品材质">
              <el-input v-model="form.collection_material" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitForm">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Picture, Upload } from '@element-plus/icons-vue'
import axios from '../utils/axios'  // 使用封装的axios实例
import { useRouter } from 'vue-router'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'

const router = useRouter()
const baseUrl = 'https://api.wx.2000gallery.art:2000'
const artworks = ref([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const loading = ref(false)
const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0
})

// 搜索相关状态
const searchKeyword = ref('')
const isSearchMode = ref(false)
const form = ref({
  title: '',
  image: '',
  long_description: '',
  artist_id: '',
  year: new Date().getFullYear(),
  original_price: 0,
  discount_price: 0,
  stock: 0,
  is_on_sale: 1,
  description: '',
  collection_number: '',
  collection_size: '',
  collection_material: ''
})

const formRef = ref(null)

// 拖拽上传相关状态
const isDragOver = ref(false)
const uploadProgress = ref(0)
const isUploading = ref(false)

const rules = {
  original_price: [
    { required: true, message: '请输入原价', trigger: 'blur' },
    { type: 'number', min: 0, message: '价格必须大于等于0', trigger: 'blur' }
  ],
  discount_price: [
    { type: 'number', min: 0, message: '折扣价必须大于等于0', trigger: 'blur' }
  ],
  stock: [
    { required: true, message: '请输入库存', trigger: 'blur' },
    { type: 'number', min: 0, message: '库存必须大于等于0', trigger: 'blur' }
  ]
}

const artistOptions = ref([])

const editorRef = ref(null)
const longDescriptionHtml = ref('')

// 重置表单的通用函数
const resetForm = () => {
  // 重置表单数据
  form.value = {
    title: '',
    image: '',
    long_description: '',
    artist_id: '',
    year: new Date().getFullYear(),
    description: '',
    background: '',
    features: '',
    original_price: 0,
    discount_price: 0,
    stock: 0,
    sales: 0,
    is_on_sale: 1,
    collection_number: '',
    collection_size: '',
    collection_material: ''
  }
  
  // 重置富文本编辑器内容
  longDescriptionHtml.value = ''
  
  // 重置拖拽上传状态
  isDragOver.value = false
  uploadProgress.value = 0
  isUploading.value = false
  
  // 确保富文本编辑器内容被清空
  nextTick(() => {
    if (editorRef.value && editorRef.value.setHtml) {
      editorRef.value.setHtml('')
    }
  })
}

// 图片缓存和预加载
const imageCache = new Map()
const imagePreloadQueue = new Set() // 防止重复预加载

const editorConfig = {
  // 启用图片懒加载
  EXTEND_CONF: {
    imageLazyLoad: true,
    imageLazyLoadPlaceholder: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEyIiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+5Zu+54mHPC90ZXh0Pjwvc3ZnPg=='
  },
  MENU_CONF: {
    uploadImage: {
      // 优化上传配置
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedFileTypes: ['image/*'],
      maxNumberOfFiles: 10,
      
      async customUpload(file, insertFn) {
        // 显示上传进度
        ElMessage.info('正在处理图片...');
        
        // 1. 先用你的方法处理
        const processedFile = await uploadImageToWebpLimit5MB(file);
        if (!processedFile) {
          ElMessage.error('图片处理失败');
          return;
        }

        // 2. 构造 formData 上传到后端
        const formData = new FormData();
        formData.append('file', processedFile);

        // 3. 获取 token（如有需要）
        const token = localStorage.getItem('token');

        // 4. 上传到后端
        try {
          ElMessage.info('正在上传图片...');
          
          // 记录API请求开始时间
          const apiStartTime = performance.now();
          
          const resp = await axios.post('/upload', formData, {
            timeout: 60000, // 60秒超时
            headers: {
              'Content-Type': 'multipart/form-data',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            // 添加上传进度监听
            onUploadProgress: (progressEvent) => {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              console.log('上传进度:', percentCompleted + '%');
            }
          });
          
          // 记录API响应时间
          const apiResponseTime = performance.now() - apiStartTime;
          console.log(`API响应时间: ${apiResponseTime.toFixed(2)}ms`);
          
          // 如果API响应时间过长，给出警告
          if (apiResponseTime > 5000) {
            console.warn(`API响应时间过长: ${apiResponseTime.toFixed(2)}ms`);
          }
          
          const result = resp;

          // 5. 兼容多种返回格式
          let url = '';
          if (result.url) {
            url = result.url;
          } else if (result.data && result.data.url) {
            url = result.data.url;
          }

          if (typeof url === 'string' && url) {
            // 立即插入图片，不延迟
            insertFn(url);
            ElMessage.success('图片上传成功');
          } else {
            ElMessage.error(result.message || '图片上传失败');
          }
        } catch (err) {
          console.error('图片上传异常:', err);
          ElMessage.error('图片上传异常');
        }
      },
      
      // 上传进度回调
      onProgress(progress) {
        console.log('图片上传进度:', progress);
      },
      
      // 上传成功回调
      onSuccess(file, res) {
        console.log('图片上传成功:', file, res);
      },
      
      // 上传失败回调
      onFailed(file, res) {
        console.log('图片上传失败:', file, res);
        ElMessage.error('图片上传失败');
      },
      
      // 上传错误回调
      onError(file, err, res) {
        console.error('图片上传错误:', file, err, res);
        ElMessage.error('图片上传错误');
      }
    },
    uploadVideo: {
      // 自定义上传
      async customUpload(file, insertFn) {
        // 1. 构造 formData
        const formData = new FormData();
        formData.append('file', file);

        // 2. 获取 token（如有需要）
        const token = localStorage.getItem('token');

        // 3. 上传到后端
        try {
          const resp = await axios.post('/upload', formData, {
            timeout: 120000, // 视频上传需要更长时间
            headers: {
              'Content-Type': 'multipart/form-data',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
          });
          const result = resp;


          // 4. 兼容多种返回格式
          let url = '';
          let poster = '';
          if (result.url) {
            url = result.url;
          } else if (result.data && result.data.url) {
            url = result.data.url;
            poster = result.data.poster || '';
          }

          if (typeof url === 'string' && url) {
            setTimeout(() => {
              insertFn(url, poster); // poster 可选
              ElMessage.success('视频上传成功');
            }, 0);
          } else {
            ElMessage.error(result.message || '视频上传失败');
          }
        } catch (err) {
          console.error('视频上传异常:', err);
          ElMessage.error('视频上传异常');
        }
      },
      // 限制最大体积、类型、数量
      maxFileSize: 50 * 1024 * 1024, // 50M
      allowedFileTypes: ['video/mp4', 'video/webm', 'video/ogg'],
      maxNumberOfFiles: 1,
      // 上传进度、成功、失败、错误回调
      onProgress(progress) {
        // 上传进度处理
      },
      onSuccess(file, res) {
        // 上传成功处理
      },
      onFailed(file, res) {
        // 上传失败处理
      },
      onError(file, err, res) {
        // 上传错误处理
      }
    }
  }
};

const fetchArtists = async () => {
  try {
    const data = await axios.get('/artists')
    console.log('原作艺术品艺术家API返回的原始数据：', data)
    if (Array.isArray(data)) {
      artistOptions.value = data
      console.log('设置后的艺术家数据：', artistOptions.value)
    } else {
      console.error('返回的数据不是数组：', data)
      artistOptions.value = []
      ElMessage.error('获取艺术家数据格式不正确')
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    artistOptions.value = []
    ElMessage.error('获取艺术家列表失败')
  }
}

// 检查登录状态
const checkLoginStatus = () => {
  const token = localStorage.getItem('token')
  if (!token) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return false
  }
  return true
}

// 获取艺术品列表
const fetchArtworks = async () => {
  if (!checkLoginStatus()) return
  
  loading.value = true
  try {
    const response = await axios.get('/original-artworks', {
      params: {
        page: pagination.value.page,
        pageSize: pagination.value.pageSize
      }
    })

    let data = response.data || response
    let paginationInfo = response.pagination

    // 检查是否是新的分页格式
    if (response.data && response.pagination) {
      data = response.data
      paginationInfo = response.pagination
    } else if (Array.isArray(data)) {
      paginationInfo = {
        page: pagination.value.page,
        pageSize: pagination.value.pageSize,
        total: data.length // 旧格式无法获取总数，暂时使用当前页数据量
      }
    } else {
      throw new Error('无效的响应数据')
    }

    // 处理数据
    artworks.value = data.map(item => {
      // 确保数值类型正确
      const artwork = {
        ...item,
        original_price: Number(item.original_price) || 0,
        discount_price: Number(item.discount_price) || 0,
        stock: Number(item.stock) || 0,
        sales: Number(item.sales) || 0,
        is_on_sale: Number(item.is_on_sale) || 0,
        year: Number(item.year) || new Date().getFullYear()
      }

      // 处理图片URL
      if (artwork.image && !artwork.image.startsWith('http')) {
        artwork.image = `${baseUrl}${artwork.image}`
      }

      // 处理艺术家头像
      if (artwork.artist && artwork.artist.avatar && !artwork.artist.avatar.startsWith('http')) {
        artwork.artist.avatar = `${baseUrl}${artwork.artist.avatar}`
      }


      artwork.long_description = item.long_description || ''

      return artwork
    })

    // 更新分页信息
    if (paginationInfo) {
      pagination.value.total = paginationInfo.total || 0
      pagination.value.page = paginationInfo.page || 1
      pagination.value.pageSize = paginationInfo.pageSize || 20
    }
  } catch (error) {
    console.error('Error fetching artworks:', error)
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error(`获取艺术品列表失败: ${error.response.data.message || '服务器错误'}`)
      }
    } else if (error.request) {
      console.error('No response received:', error.request)
      ElMessage.error('无法连接到服务器，请检查网络连接')
    } else {
      console.error('Error message:', error.message)
      ElMessage.error(`获取艺术品列表失败: ${error.message}`)
    }
  } finally {
    loading.value = false
  }
}

// 显示添加对话框
const showAddDialog = () => {
  if (!checkLoginStatus()) return
  dialogType.value = 'add'
  resetForm()
  dialogVisible.value = true
}

// 编辑艺术品
const editArtwork = async (row) => {
  if (!checkLoginStatus()) return
  try {
    // 1. 直接用 axios.get 返回的 resp 作为 detail
    let detail = await axios.get(`/original-artworks/${row.id}`)
    // 兼容后端返回被包裹在data字段下的情况
    if (detail && detail.data) {
      detail = detail.data;
    }
    // 2. 用详情数据填充form
    dialogType.value = 'edit'
    form.value = {
      id: detail.id,
      title: detail.title || '',
      image: detail.image || '',
      long_description: detail.long_description || '',
      artist_id: detail.artist?.id || '',
      year: Number(detail.year) || new Date().getFullYear(),
      description: detail.description || '',
      background: detail.background || '',
      features: detail.features || '',
      original_price: Number(detail.original_price) || 0,
      discount_price: Number(detail.discount_price) || 0,
      stock: Number(detail.stock) || 0,
      sales: Number(detail.sales) || 0,
      is_on_sale: Number(detail.is_on_sale) || 1,
      // 移除 collection_location 字段
      collection_number: detail.collection?.number || '',
      collection_size: detail.collection?.size || '',
      collection_material: detail.collection?.material || ''
    }

    // 设置富文本编辑器内容
    longDescriptionHtml.value = form.value.long_description || ''
    // 重置拖拽上传状态
    isDragOver.value = false
    uploadProgress.value = 0
    isUploading.value = false
    dialogVisible.value = true
  } catch (error) {
    console.error('获取详细信息失败:', error)
    ElMessage.error('获取详细信息失败，无法编辑')
  }
}

// 删除艺术品
const deleteArtwork = async (row) => {
  if (!checkLoginStatus()) return
  try {
    await ElMessageBox.confirm('确定要删除这个艺术品吗？', '提示', {
      type: 'warning'
    })
    const response = await axios.delete(`/original-artworks/${row.id}`)
    ElMessage.success('删除成功')
    // 删除后重置到第一页
    pagination.value.page = 1
    fetchArtworks().then(() => {
      scrollToTop()
    })
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Delete error:', error)
      if (error.response) {
        if (error.response.status === 401) {
          ElMessage.error('登录已过期，请重新登录')
          router.push('/login')
        } else {
          ElMessage.error(error.response.data.message || '删除失败')
        }
      } else {
        ElMessage.error('删除失败')
      }
    }
  }
}

// 提交表单
const submitForm = async () => {
  if (!checkLoginStatus()) return
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    const submitData = {
      title: form.value.title,
      image: form.value.image,
      long_description: longDescriptionHtml.value,
      artist_id: form.value.artist_id,
      year: Number(form.value.year),
      description: form.value.description,
      background: form.value.background,
      features: form.value.features,
      original_price: Number(form.value.original_price),
      discount_price: Number(form.value.discount_price),
      stock: Number(form.value.stock),
      sales: Number(form.value.sales),
      is_on_sale: Number(form.value.is_on_sale),
      // 移除 collection_location 字段
      collection_number: form.value.collection_number,
      collection_size: form.value.collection_size,
      collection_material: form.value.collection_material
    }

    if (dialogType.value === 'add') {
      const response = await axios.post('/original-artworks', submitData)
      ElMessage.success('添加成功')
      // 添加后重置到第一页
      pagination.value.page = 1
    } else {
      if (!form.value.id) {
        ElMessage.error('未获取到作品ID，无法保存')
        return
      }
      const response = await axios.put(`/original-artworks/${form.value.id}`, submitData)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    resetForm()
    fetchArtworks().then(() => {
      scrollToTop()
    })
  } catch (error) {
    console.error('Submit error:', error)
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error(error.response.data.message || '操作失败')
      }
    } else {
      ElMessage.error('表单验证失败，请检查输入')
    }
  }
}

// 上传图片相关方法
const handleUploadSuccess = (response) => {
  console.log('handleUploadSuccess 收到的响应:', response);
  console.log('响应类型:', typeof response);
  console.log('响应是否为对象:', typeof response === 'object');
  
  // 防重复处理：如果响应为空或undefined，直接返回
  if (!response) {
    console.log('响应为空，跳过处理');
    return;
  }
  
  // 兼容多种返回格式
  let url = '';
  
  // 检查 response.url
  if (response && response.url) {
    console.log('找到 response.url:', response.url);
    url = response.url;
  } 
  // 检查 response.data.url
  else if (response && response.data && response.data.url) {
    console.log('找到 response.data.url:', response.data.url);
    url = response.data.url;
  } 
  // 检查 response.data（如果data本身就是url字符串）
  else if (response && response.data && typeof response.data === 'string') {
    console.log('找到 response.data (字符串):', response.data);
    url = response.data;
  }
  // 检查 response 本身是否为字符串
  else if (typeof response === 'string') {
    console.log('response 本身是字符串:', response);
    url = response;
  }
  // 检查其他可能的字段
  else if (response && response.path) {
    console.log('找到 response.path:', response.path);
    url = response.path;
  }
  else if (response && response.file) {
    console.log('找到 response.file:', response.file);
    url = response.file;
  }
  else if (response && response.filename) {
    console.log('找到 response.filename:', response.filename);
    url = response.filename;
  }
  
  console.log('最终提取的URL:', url);
  
  if (url) {
    form.value.image = url;
    ElMessage.success('图片上传成功');
  } else {
    console.error('无法从响应中提取URL，完整响应:', response);
    ElMessage.error('图片上传失败：未获取到图片URL');
  }
}

const customUpload = async (options) => {
  const { onSuccess, onError, file, onProgress } = options;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await axios.post(`${baseUrl}/api/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          uploadProgress.value = percent;
          onProgress({ percent });
        } else {
          // 如果没有total，模拟进度
          uploadProgress.value = Math.min(uploadProgress.value + 10, 90);
          onProgress({ percent: uploadProgress.value });
        }
      }
    });
    
    console.log('customUpload 收到的完整响应:', response);
    console.log('customUpload response.data:', response.data);
    
    // 上传完成
    uploadProgress.value = 100;
    setTimeout(() => {
      uploadProgress.value = 0;
      isUploading.value = false;
    }, 1000);
    
         // 确保传递正确的数据给 onSuccess
     console.log('调用 onSuccess，传递数据:', response);
     onSuccess(response);
  } catch (error) {
    console.error('customUpload 错误:', error);
    uploadProgress.value = 0;
    isUploading.value = false;
    onError(error);
    ElMessage.error('上传失败：' + (error.response?.data?.message || '未知错误'));
  }
};

// 监听拖拽状态
const handleDragEnter = (e) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = true;
};

const handleDragLeave = (e) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
};

const handleDragOver = (e) => {
  e.preventDefault();
  e.stopPropagation();
};

const handleDrop = (e) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
};

const beforeUpload = async (file) => {
  // 文件类型验证
  const isImage = file.type.startsWith('image/')
  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }

  // 文件大小验证 (5MB)
  const isLt5M = file.size / 1024 / 1024 < 50
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过 50MB!')
    return false
  }

  // 重置进度和上传状态
  uploadProgress.value = 0
  isUploading.value = true

  const result = await uploadImageToWebpLimit5MB(file)
  if (!result) return false
  return Promise.resolve(result)
}

// 网络性能检测
const checkNetworkPerformance = () => {
  if ('connection' in navigator) {
    const connection = navigator.connection;
    console.log('网络连接信息:', {
      effectiveType: connection.effectiveType, // 4g, 3g, 2g, slow-2g
      downlink: connection.downlink, // 下行速度 (Mbps)
      rtt: connection.rtt, // 往返时间 (ms)
      saveData: connection.saveData // 是否开启数据节省模式
    });
    
    // 根据网络状况调整图片加载策略
    if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
      console.warn('网络状况较差，建议使用较小的图片');
    }
  }
}

const handleEditorCreated = (editor) => {
  if (editorRef) {
    editorRef.value = editor
  }
  
  // 检测网络性能
  checkNetworkPerformance();
  
  // 优化编辑器中的图片加载
  if (editor) {
    // 监听图片插入事件
    editor.on('insertedImage', (imageNode) => {
      if (imageNode && imageNode.src) {
        // 检查缓存
        if (imageCache.has(imageNode.src)) {
          console.log('图片已缓存，直接使用:', imageNode.src);
          return;
        }
        
        // 防止重复预加载
        if (imagePreloadQueue.has(imageNode.src)) {
          console.log('图片正在预加载中:', imageNode.src);
          return;
        }
        
        // 添加到预加载队列
        imagePreloadQueue.add(imageNode.src);
        
        // 记录开始时间
        const startTime = performance.now();
        
        // 预加载图片
        const img = new Image();
        img.onload = () => {
          const loadTime = performance.now() - startTime;
          console.log(`图片预加载成功: ${imageNode.src}, 耗时: ${loadTime.toFixed(2)}ms`);
          
          // 记录加载时间
          imageLoadTimes.set(imageNode.src, loadTime);
          
          // 缓存图片
          imageCache.set(imageNode.src, img);
          // 从预加载队列中移除
          imagePreloadQueue.delete(imageNode.src);
          
          // 如果加载时间过长，给出警告
          if (loadTime > 3000) {
            console.warn(`图片加载时间过长: ${imageNode.src}, 耗时: ${loadTime.toFixed(2)}ms`);
          }
        };
        img.onerror = () => {
          console.log('图片预加载失败:', imageNode.src);
          // 设置错误占位符
          imageNode.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2ZlZjBmMCIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEyIiBmaWxsPSIjZjU2YzZjIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+5Zu+54mH5aSx6KSlPC90ZXh0Pjwvc3ZnPg==';
          // 从预加载队列中移除
          imagePreloadQueue.delete(imageNode.src);
        };
        img.src = imageNode.src;
      }
    });
  }
}

// 回到顶部函数
const scrollToTop = () => {
  nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

// 分页事件处理
const handleSizeChange = (newSize) => {
  pagination.value.pageSize = newSize
  pagination.value.page = 1 // 重置到第一页
  if (isSearchMode.value) {
    fetchSearchResults().then(() => {
      scrollToTop()
    })
  } else {
    fetchArtworks().then(() => {
      scrollToTop()
    })
  }
}

const handleCurrentChange = (newPage) => {
  pagination.value.page = newPage
  if (isSearchMode.value) {
    fetchSearchResults().then(() => {
      scrollToTop()
    })
  } else {
    fetchArtworks().then(() => {
      scrollToTop()
    })
  }
}



// 搜索处理
const handleSearch = async () => {
  if (!searchKeyword.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  
  isSearchMode.value = true
  pagination.value.page = 1
  await fetchSearchResults()
  scrollToTop()
}

// 清除搜索
const handleClearSearch = () => {
  searchKeyword.value = ''
  isSearchMode.value = false
  pagination.value.page = 1
  fetchArtworks().then(() => {
    scrollToTop()
  })
}

// 获取搜索结果
const fetchSearchResults = async () => {
  if (!checkLoginStatus()) return
  
  loading.value = true
  try {
    const response = await axios.get('/search', {
      params: {
        keyword: searchKeyword.value.trim(),
        type: 'original_artwork',
        page: pagination.value.page,
        limit: pagination.value.pageSize
      }
    })

    let data = response.data || []
    let paginationInfo = response.pagination

    // 处理搜索结果数据
    artworks.value = data.map(item => {
      const artwork = {
        ...item,
        original_price: Number(item.original_price) || 0,
        discount_price: Number(item.discount_price) || 0,
        stock: Number(item.stock) || 0,
        sales: Number(item.sales) || 0,
        is_on_sale: Number(item.is_on_sale) || 0,
        year: Number(item.year) || new Date().getFullYear(),
        artist_name: item.artist_name || ''
      }

      // 处理图片URL
      if (artwork.image && !artwork.image.startsWith('http')) {
        artwork.image = `${baseUrl}${artwork.image}`
      }


      artwork.long_description = item.long_description || ''

      return artwork
    })

    // 更新分页信息
    if (paginationInfo) {
      pagination.value.total = paginationInfo.total_count || 0
      pagination.value.page = paginationInfo.current_page || 1
      pagination.value.pageSize = paginationInfo.page_size || 20
    }
  } catch (error) {
    console.error('搜索失败:', error)
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        ElMessage.error(`搜索失败: ${error.response.data.error || '服务器错误'}`)
      }
    } else {
      ElMessage.error('搜索失败，请检查网络连接')
    }
  } finally {
    loading.value = false
  }
}

// 刷新数据
const refreshData = () => {
  pagination.value.page = 1
  if (isSearchMode.value) {
    fetchSearchResults().then(() => {
      scrollToTop()
    })
  } else {
    fetchArtworks().then(() => {
      scrollToTop()
    })
  }
}

// 图片加载性能监控
const imageLoadTimes = new Map()

// 性能监控总结
const getPerformanceSummary = () => {
  const loadTimes = Array.from(imageLoadTimes.values());
  if (loadTimes.length === 0) return null;
  
  const avgLoadTime = loadTimes.reduce((sum, time) => sum + time, 0) / loadTimes.length;
  const maxLoadTime = Math.max(...loadTimes);
  const minLoadTime = Math.min(...loadTimes);
  
  return {
    totalImages: loadTimes.length,
    averageLoadTime: avgLoadTime.toFixed(2),
    maxLoadTime: maxLoadTime.toFixed(2),
    minLoadTime: minLoadTime.toFixed(2),
    slowImages: loadTimes.filter(time => time > 3000).length
  };
}

// 监听对话框关闭，清理富文本编辑器内容和缓存
watch(dialogVisible, (newVal) => {
  if (!newVal) {
    // 对话框关闭时完全重置状态
    resetForm()
    
    // 输出性能监控总结
    const performanceSummary = getPerformanceSummary();
    if (performanceSummary) {
      console.log('图片加载性能总结:', performanceSummary);
    }
    
    // 清理图片缓存和监控数据
    imageCache.clear()
    imagePreloadQueue.clear()
    imageLoadTimes.clear()
    console.log('图片缓存和监控数据已清理');
  }
})

onMounted(() => {
  fetchArtists()
  // 初始化分页参数
  pagination.value = {
    page: 1,
    pageSize: 20,
    total: 0
  }
  checkLoginStatus() && fetchArtworks()
})

onBeforeUnmount(() => {
  if (editorRef.value && editorRef.value.destroy) editorRef.value.destroy()
})
</script>

<style scoped>
.artworks-container {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-buttons {
  display: flex;
  gap: 10px;
}

.search-container {
  margin-bottom: 20px;
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.search-result-tip {
  margin-top: 15px;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  background-color: #f5f5f5;
  border-radius: 4px;
}

.pagination-info {
  color: #666;
  font-size: 14px;
}



.avatar-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 178px;
  height: 178px;
  transition: all 0.3s ease;
}

.avatar-uploader:hover {
  border-color: #409EFF;
}

.avatar-uploader.uploading {
  opacity: 0.7;
  pointer-events: none;
}

.avatar-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 178px;
  height: 178px;
  text-align: center;
  line-height: 178px;
}

.avatar {
  width: 178px;
  height: 178px;
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
  min-height: 178px;
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

.original-price {
  text-decoration: line-through;
  color: #999;
  margin-right: 10px;
}

.discount-price {
  color: #f56c6c;
  font-weight: bold;
}

:deep(.el-input-number) {
  width: 100%;
}

.image-placeholder,
.image-error {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 80px;
  height: 80px;
  background-color: #f5f7fa;
  color: #c0c4cc;
  font-size: 20px;
}

.image-error {
  background-color: #fef0f0;
  color: #f56c6c;
}

.upload-placeholder,
.upload-error {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 178px;
  height: 178px;
  background-color: #f5f7fa;
  color: #c0c4cc;
  font-size: 28px;
}

.upload-error {
  background-color: #fef0f0;
  color: #f56c6c;
}
</style> 