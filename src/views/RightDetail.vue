<template>
  <div class="right-detail">
    <el-page-header @back="goBack" :title="'返回列表'" />
    
    <el-card v-loading="loading" class="detail-card">
      <template #header>
        <div class="card-header">
          <span>版权实物详情</span>
          <el-button type="primary" @click="handleEdit">编辑</el-button>
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="form.title" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="form.status" placeholder="请选择状态">
                <el-option label="在售" value="onsale" />
                <el-option label="已售罄" value="soldout" />
                <el-option label="即将发售" value="upcoming" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="价格">
              <el-input-number v-model="form.price" :precision="2" :step="0.1" :min="0" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="原价">
              <el-input-number v-model="form.originalPrice" :precision="2" :step="0.1" :min="0" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="期限">
              <el-input v-model="form.period" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="剩余数量">
              <el-input-number v-model="form.remainingCount" :min="0" :max="form.totalCount" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="总数量">
          <el-input-number v-model="form.totalCount" :min="0" />
        </el-form-item>

        <el-form-item label="富文本内容">
          <div v-if="!isEditing">
            <div v-html="form.rich_text"></div>
          </div>
          <div v-else>
            <Toolbar :editor="editorRef" style="width: 100%" />
            <Editor
              v-model="richTextHtml"
              :defaultConfig="{ placeholder: '请输入富文本内容...', ...editorConfig }"
              mode="default"
              style="width: 100%; min-width: 400px; height: 300px; border: 1px solid #ccc"
              @onCreated="handleEditorCreated"
            />
          </div>
        </el-form-item>

        <el-divider>图片列表</el-divider>

        <el-form-item label="图片列表">
          <el-upload
            class="upload-list"
            :action="`${API_BASE_URL}/api/upload`"
            list-type="picture-card"
            :on-success="handleImageSuccess"
            :on-remove="handleImageRemove"
            :before-upload="beforeImageUpload"
            :file-list="fileList"
            name="file"
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
        </el-form-item>

        <el-divider>详情列表</el-divider>

        <div v-for="(detail, index) in form.details" :key="index" class="detail-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'标题'">
                <el-input v-model="detail.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'内容'">
                <el-input v-model="detail.content" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeDetail(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addDetail">添加详情</el-button>
        </el-form-item>

        <el-divider>规则列表</el-divider>

        <div v-for="(rule, index) in form.rules" :key="index" class="rule-item">
          <el-row :gutter="20">
            <el-col :span="10">
              <el-form-item :label="'标题'">
                <el-input v-model="rule.title" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="'内容'">
                <el-input v-model="rule.content" />
              </el-form-item>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" @click="removeRule(index)">删除</el-button>
            </el-col>
          </el-row>
        </div>

        <el-form-item>
          <el-button type="primary" @click="addRule">添加规则</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import { onBeforeUnmount } from 'vue'

const route = useRoute()
const router = useRouter()
const loading = ref(false)

const form = ref({
  title: '',
  price: 0,
  originalPrice: 0,
  description: '',
  status: '',
  period: '',
  remainingCount: 0,
  totalCount: 0,
  images: [],
  details: [],
  rules: [],
  rich_text: ''
})

const fileList = ref([])

watch(() => form.value.images, (newVal) => {
  fileList.value = (newVal || []).map(url => ({
    url: getImageUrl(url),
    name: url.split('/').pop()
  }))
}, { immediate: true })

const editorRef = ref(null)
const richTextHtml = ref('')
const isEditing = ref(false)

const editorConfig = {
  MENU_CONF: {
    uploadImage: {
      async customUpload(file, insertFn) {
        const processedFile = await uploadImageToWebpLimit5MB(file);
        if (!processedFile) {
          ElMessage.error('图片处理失败');
          return;
        }
        const formData = new FormData();
        formData.append('file', processedFile);
        const token = localStorage.getItem('token');
        try {
          const resp = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          const result = await resp.json();
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
          ElMessage.error('图片上传异常');
        }
      }
    }
  }
}

const handleEditorCreated = (editor) => {
  editorRef.value = editor
}

const fetchRightDetail = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/api/rights/detail/${route.params.id}`)
    const data = response.data
    form.value = {
      ...data,
      images: data.images || [],
      details: data.details || [],
      rules: data.rules || [],
      rich_text: data.rich_text || ''
    }
  } catch (error) {
    ElMessage.error('获取版权实物详情失败')
  } finally {
    loading.value = false
  }
}

const handleImageSuccess = (response) => {
  if (!form.value.images) form.value.images = []
  let url = response.url
  if (!url.startsWith('http') && !url.startsWith('/')) url = '/' + url
  form.value.images.push(url)
}

const handleImageRemove = (file) => {
  form.value.images = form.value.images.filter(url => getImageUrl(url) !== file.url)
}

const beforeImageUpload = async (file) => {
  const result = await uploadImageToWebpLimit5MB(file)
  if (!result) return false
  return Promise.resolve(result)
}

const addDetail = () => {
  form.value.details.push({
    title: '',
    content: ''
  })
}

const removeDetail = (index) => {
  form.value.details.splice(index, 1)
}

const addRule = () => {
  form.value.rules.push({
    title: '',
    content: ''
  })
}

const removeRule = (index) => {
  form.value.rules.splice(index, 1)
}

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('https://wx.oss.2000gallery.art/')) {
    return url;
  }
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

const handleEdit = async () => {
  if (!form.value.images || form.value.images.length === 0) {
    ElMessage.warning('请至少上传一张图片');
    return;
  }
  isEditing.value = true
  richTextHtml.value = form.value.rich_text || ''
}

const saveEdit = async () => {
  try {
    const submitData = {
      ...form.value,
      rich_text: richTextHtml.value,
      images: form.value.images.map(image => {
        if (typeof image === 'string') {
          if (image.startsWith('https://wx.oss.2000gallery.art/')) {
            return image;
          }
          if (image.startsWith('http')) {
            const url = new URL(image);
            return url.pathname;
          }
          return image;
        }
        return image.url || image;
      })
    };
    await axios.put(`/api/rights/${route.params.id}`, submitData);
    ElMessage.success('更新成功');
    isEditing.value = false
    form.value.rich_text = richTextHtml.value
  } catch (error) {
    ElMessage.error('更新失败');
  }
}

const goBack = () => {
  router.push('/rights')
}

onMounted(() => {
  fetchRightDetail()
})

onBeforeUnmount(() => {
  if (editorRef.value && editorRef.value.destroy) editorRef.value.destroy()
})
</script>

<style scoped>
.right-detail {
  padding: 20px;
}

.detail-card {
  margin-top: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.upload-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.detail-item,
.rule-item {
  margin-bottom: 20px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
</style> 