<template>
  <div class="artworks-container">
         <div class="header">
       <h2>艺术品管理</h2>
       <div class="header-buttons">
         <el-button type="success" @click="toggleLazyMode">
           {{ isLazyMode ? '分页模式' : '懒加载模式' }}
         </el-button>
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
      :height="isLazyMode ? '600' : 'auto'"
      @scroll="isLazyMode ? handleTableScroll : undefined"
    >
      <el-table-column prop="title" label="标题" />
      <el-table-column label="图片" width="120">
        <template #default="{ row }">
          <el-image 
            :src="row.image" 
            :preview-src-list="[row.image]"
            fit="cover"
            style="width: 80px; height: 80px"
          />
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

    <!-- 懒加载模式下的组件 -->
    <template v-if="isLazyMode">
      <!-- 加载更多按钮 -->
      <div class="load-more-container" v-if="hasMoreData">
        <el-button 
          type="primary" 
          :loading="isLoadingMore" 
          @click="loadMoreData"
          style="width: 200px; margin: 20px auto; display: block;"
        >
          {{ isLoadingMore ? '加载中...' : '加载更多' }}
        </el-button>
      </div>

      <!-- 没有更多数据提示 -->
      <div class="no-more-data" v-if="!hasMoreData && artworks.length > 0">
        <el-divider>
          <span style="color: #999; font-size: 14px;">没有更多数据了</span>
        </el-divider>
      </div>

             <!-- 懒加载模式下的分页信息 -->
       <div class="pagination-container">
         <div class="pagination-info">
           <span v-if="isSearchMode">搜索结果：</span>
           <span>已加载 {{ artworks.length }} 条数据</span>
           <span v-if="pagination.total > 0">，共 {{ pagination.total }} 条</span>
         </div>
        <el-pagination
          :current-page="pagination.page"
          :page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="sizes"
          @size-change="handleSizeChange"
          @update:page-size="(val) => pagination.pageSize = val"
        />
      </div>
    </template>

         <!-- 传统分页模式下的组件 -->
     <template v-else>
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
     </template>

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
            :action="`${baseUrl}/api/upload`"
            :show-file-list="false"
            :on-success="handleUploadSuccess"
            :before-upload="beforeUpload"
          >
            <img v-if="form.image" :src="form.image" class="avatar" />
            <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="多图">
          <el-upload
            :file-list="form.images"
            list-type="picture-card"
            :action="`${baseUrl}/api/upload`"
            :on-success="handleMultiImageSuccess"
            :on-remove="handleMultiImageRemove"
            :before-upload="beforeUpload"
            multiple
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
        </el-form-item>
        <el-form-item label="详情富文本" style="width: 100%">
          <Toolbar :editor="editorRef" style="width: 100%" />
          <Editor
            v-model="longDescriptionHtml"
            :defaultConfig="{ placeholder: '请输入内容...', ...editorConfig }"
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
          <!-- 移除收藏位置表单项 -->
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
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
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

// 懒加载相关状态
const isLoadingMore = ref(false)
const hasMoreData = ref(true)
const isLazyMode = ref(true) // 默认使用懒加载模式

// 搜索相关状态
const searchKeyword = ref('')
const isSearchMode = ref(false)
const form = ref({
  title: '',
  image: '',
  images: [],
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

const editorConfig = {
  MENU_CONF: {
    uploadImage: {
      async customUpload(file, insertFn) {
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
          const resp = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          const result = await resp.json();


          // 5. 兼容多种返回格式
          let url = '';
          if (result.url) {
            url = result.url;
          } else if (result.data && result.data.url) {
            url = result.data.url;
          }

          if (typeof url === 'string' && url) {
            setTimeout(() => {
              insertFn(url);
              ElMessage.success('图片上传成功');
            }, 0);
          } else {
            ElMessage.error(result.message || '图片上传失败');
          }
        } catch (err) {
          console.error('图片上传异常:', err);
          ElMessage.error('图片上传异常');
        }
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
          const resp = await fetch(`${baseUrl}/api/upload`, {
            method: 'POST',
            body: formData,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          const result = await resp.json();


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
    if (Array.isArray(data)) {
      artistOptions.value = data
    } else {
      artistOptions.value = []
    }
  } catch (error) {
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

      artwork.images = item.images || []
      artwork.long_description = item.long_description || ''

      return artwork
    })

    // 更新分页信息
    if (paginationInfo) {
      pagination.value.total = paginationInfo.total || 0
      pagination.value.page = paginationInfo.page || 1
      pagination.value.pageSize = paginationInfo.pageSize || 20
      
      // 检查是否还有更多数据
      const currentTotal = artworks.value.length
      hasMoreData.value = currentTotal < pagination.value.total
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
  form.value = {
    title: '',
    image: '',
    images: [],
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
    // 移除 collection_location 字段
    collection_number: '',
    collection_size: '',
    collection_material: ''
  }
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
      images: (detail.images || []).map((img, idx) => ({ url: img, name: `图片${idx + 1}`, uid: `${Date.now()}-${idx}` })),
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

    dialogVisible.value = true
    nextTick(() => {
      longDescriptionHtml.value = form.value.long_description
    })
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
    fetchArtworks()
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
      images: form.value.images.map(img => img.url),
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
    fetchArtworks()
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
  form.value.image = response.url
}

const handleMultiImageSuccess = (response, file) => {
  const url = response.url || (response.data && response.data.url)
  form.value.images.push({
    url,
    name: response.name || file.name,
    uid: file.uid
  })

}

const handleMultiImageRemove = (file, fileList) => {
  form.value.images = fileList.map(f => ({
    url: f.url,
    name: f.name,
    uid: f.uid
  }))
}

const beforeUpload = async (file) => {
  const result = await uploadImageToWebpLimit5MB(file)
  if (!result) return false
  return Promise.resolve(result)
}

const handleEditorCreated = (editor) => {
  if (editorRef) {
    editorRef.value = editor
  }
}

// 分页事件处理
const handleSizeChange = (newSize) => {
  pagination.value.pageSize = newSize
  pagination.value.page = 1 // 重置到第一页
  // 重置懒加载状态
  hasMoreData.value = true
  if (isSearchMode.value) {
    fetchSearchResults()
  } else {
    fetchArtworks()
  }
  // 回到顶部
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const handleCurrentChange = (newPage) => {
  pagination.value.page = newPage
  if (isSearchMode.value) {
    fetchSearchResults()
  } else {
    fetchArtworks()
  }
  // 回到顶部
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// 表格滚动事件处理
const handleTableScroll = (e) => {
  const { scrollTop, scrollHeight, clientHeight } = e.target
  // 当滚动到底部时加载更多数据
  if (scrollHeight - scrollTop - clientHeight < 50 && !isLoadingMore.value && hasMoreData.value) {
    loadMoreData()
  }
}

// 懒加载更多数据
const loadMoreData = async () => {
  if (isLoadingMore.value || !hasMoreData.value) return
  
  isLoadingMore.value = true
  try {
    const nextPage = pagination.value.page + 1
    
    // 根据当前模式选择API
    let response
    if (isSearchMode.value) {
      response = await axios.get('/search', {
        params: {
          keyword: searchKeyword.value.trim(),
          type: 'original_artwork',
          page: nextPage,
          limit: pagination.value.pageSize
        }
      })
    } else {
      response = await axios.get('/original-artworks', {
        params: {
          page: nextPage,
          pageSize: pagination.value.pageSize
        }
      })
    }

    let data = response.data || response
    let paginationInfo = response.pagination

    // 检查是否是新的分页格式
    if (response.data && response.pagination) {
      data = response.data
      paginationInfo = response.pagination
    } else if (Array.isArray(data)) {
      paginationInfo = {
        page: nextPage,
        pageSize: pagination.value.pageSize,
        total: data.length
      }
    } else {
      throw new Error('无效的响应数据')
    }

    // 处理新数据
    const newArtworks = data.map(item => {
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

      // 处理艺术家头像
      if (artwork.artist && artwork.artist.avatar && !artwork.artist.avatar.startsWith('http')) {
        artwork.artist.avatar = `${baseUrl}${artwork.artist.avatar}`
      }

      artwork.images = item.images || []
      artwork.long_description = item.long_description || ''

      return artwork
    })

    // 追加新数据到现有数据
    artworks.value = [...artworks.value, ...newArtworks]
    
    // 更新分页信息
    if (paginationInfo) {
      pagination.value.page = paginationInfo.current_page || paginationInfo.page || nextPage
      pagination.value.total = paginationInfo.total_count || paginationInfo.total || 0
      
      // 检查是否还有更多数据
      const currentTotal = artworks.value.length
      hasMoreData.value = currentTotal < pagination.value.total
    }

    // 如果没有新数据，标记为没有更多数据
    if (newArtworks.length === 0) {
      hasMoreData.value = false
    }
  } catch (error) {
    console.error('加载更多数据失败:', error)
    ElMessage.error('加载更多数据失败')
  } finally {
    isLoadingMore.value = false
  }
}

// 切换懒加载模式
const toggleLazyMode = () => {
  isLazyMode.value = !isLazyMode.value
  // 重置状态
  hasMoreData.value = true
  pagination.value.page = 1
  if (isSearchMode.value) {
    fetchSearchResults()
  } else {
    fetchArtworks()
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
  hasMoreData.value = true
  await fetchSearchResults()
}

// 清除搜索
const handleClearSearch = () => {
  searchKeyword.value = ''
  isSearchMode.value = false
  pagination.value.page = 1
  hasMoreData.value = true
  fetchArtworks()
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

      artwork.images = item.images || []
      artwork.long_description = item.long_description || ''

      return artwork
    })

    // 更新分页信息
    if (paginationInfo) {
      pagination.value.total = paginationInfo.total_count || 0
      pagination.value.page = paginationInfo.current_page || 1
      pagination.value.pageSize = paginationInfo.page_size || 20
      
      // 检查是否还有更多数据
      const currentTotal = artworks.value.length
      hasMoreData.value = currentTotal < pagination.value.total
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
  // 重置懒加载状态
  hasMoreData.value = true
  pagination.value.page = 1
  if (isSearchMode.value) {
    fetchSearchResults()
  } else {
    fetchArtworks()
  }
}

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

.load-more-container {
  text-align: center;
  margin: 20px 0;
}

.no-more-data {
  margin: 20px 0;
}

.avatar-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 178px;
  height: 178px;
}

.avatar-uploader:hover {
  border-color: #409EFF;
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
</style> 