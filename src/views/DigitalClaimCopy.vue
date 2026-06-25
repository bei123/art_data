<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-2">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        数字藏品领取说明
      </h2>
      <p class="text-sm text-muted-foreground">
        文案保存在服务端，小程序按需拉取。支持文字、图片、链接三种内容块；可使用
        <code class="rounded bg-muted px-1">{platform}</code>
        占位符（替换为作品发行方）。
      </p>
      <p v-if="forceHidden" class="text-sm font-medium text-amber-600 dark:text-amber-400">
        当前环境变量 DIGITAL_CLAIM_COPY_FORCE_HIDDEN 已开启，小程序端将强制隐藏所有领取说明。
      </p>
    </div>

    <Alert v-if="loadError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ loadError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="loadConfig">
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <Card class="relative overflow-hidden shadow-none ring-1">
      <div
        v-if="loading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>

      <CardHeader>
        <CardTitle class="text-base">展示开关</CardTitle>
        <CardDescription>关闭后小程序不展示对应区块，便于通过微信审核。</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p class="font-medium text-foreground">资产页说明卡片</p>
            <p class="text-sm text-muted-foreground">「我的资产」列表上方的领取说明</p>
          </div>
          <Checkbox
            :model-value="form.list_visible"
            aria-label="资产页说明卡片"
            @update:model-value="(v) => { form.list_visible = v === true }"
          />
        </div>
        <div class="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p class="font-medium text-foreground">领取码弹层使用说明</p>
            <p class="text-sm text-muted-foreground">点击「查看领取码」后弹层内的说明内容</p>
          </div>
          <Checkbox
            :model-value="form.sheet_guide_visible"
            aria-label="领取码弹层使用说明"
            @update:model-value="(v) => { form.sheet_guide_visible = v === true }"
          />
        </div>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardHeader>
        <CardTitle class="text-base">基础信息</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid gap-2">
          <Label for="guide-title">说明标题</Label>
          <Input id="guide-title" v-model="form.guide_title" maxlength="64" placeholder="数字藏品领取说明" />
        </div>
      </CardContent>
    </Card>

    <ClaimCopyBlockSection
      title="资产页内容"
      description="展示在「我的资产」页说明卡片内，可混合文字、图片和链接。"
      :blocks="form.list_blocks"
      :uploading-index="uploadingListIndex"
      @add="(type) => addBlock('list_blocks', type)"
      @remove="(index) => removeBlock('list_blocks', index)"
      @move-up="(index) => moveBlock('list_blocks', index, -1)"
      @move-down="(index) => moveBlock('list_blocks', index, 1)"
      @upload="(index, file) => uploadBlockImage('list_blocks', index, file)"
      @update-block="(index, patch) => updateBlock('list_blocks', index, patch)"
    />

    <ClaimCopyBlockSection
      title="领取码弹层内容"
      description="展示在领取二维码弹层内，建议补充操作步骤、App 下载图或官网链接。"
      :blocks="form.sheet_blocks"
      :uploading-index="uploadingSheetIndex"
      @add="(type) => addBlock('sheet_blocks', type)"
      @remove="(index) => removeBlock('sheet_blocks', index)"
      @move-up="(index) => moveBlock('sheet_blocks', index, -1)"
      @move-down="(index) => moveBlock('sheet_blocks', index, 1)"
      @upload="(index, file) => uploadBlockImage('sheet_blocks', index, file)"
      @update-block="(index, patch) => updateBlock('sheet_blocks', index, patch)"
    >
      <template #actions>
        <Button type="button" variant="outline" size="sm" @click="copyListBlocksToSheet">
          从资产页复制
        </Button>
      </template>
    </ClaimCopyBlockSection>

    <div class="flex flex-wrap gap-2">
      <Button type="button" variant="outline" @click="resetToDefault">
        恢复默认文案
      </Button>
      <Button type="button" :disabled="saving" @click="saveConfig">
        <Loader2 v-if="saving" class="mr-2 size-4 animate-spin" aria-hidden="true" />
        {{ saving ? '保存中…' : '保存配置' }}
      </Button>
    </div>
  </div>
</template>

<script setup>
import { defineComponent, h, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { AlertCircle, ArrowDown, ArrowUp, ImagePlus, Link2, Loader2, Trash2, Type } from 'lucide-vue-next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { showPageSuccess, showPageWarning } from '@/utils/appMessage'
import { API_BASE_URL } from '@/config'
import { uploadImageToWebpLimit5MB } from '@/utils/image'

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const forceHidden = ref(false)
const uploadingListIndex = ref(-1)
const uploadingSheetIndex = ref(-1)

const form = reactive({
  list_visible: false,
  sheet_guide_visible: false,
  guide_title: '',
  list_blocks: [],
  sheet_blocks: [],
})

const DEFAULT_FORM = {
  list_visible: false,
  sheet_guide_visible: false,
  guide_title: '数字藏品领取说明',
  list_blocks: [
    { type: 'text', content: '请使用「{platform}」官方 App 扫码领取。如尚未安装，可在应用商店搜索「{platform}」下载。' },
    { type: 'text', content: '在应用商店搜索并安装「{platform}」' },
    { type: 'text', content: '打开「{platform}」并登录账号（建议与购买时使用的手机号一致）' },
    { type: 'text', content: '点击「查看领取码」，保存或截图二维码（也可用另一台手机展示）' },
    { type: 'text', content: '在 App 内找到「扫码领取」「典藏领取」或类似入口，扫描领取二维码' },
    { type: 'text', content: '领取成功后，藏品将出现在您的账号藏品库中' },
  ],
  sheet_blocks: [
    { type: 'text', content: '点击二维码可放大保存，打开「{platform}」扫码领取' },
    { type: 'text', content: '在应用商店搜索并安装「{platform}」' },
    { type: 'text', content: '打开「{platform}」并登录账号（建议与购买时使用的手机号一致）' },
    { type: 'text', content: '在 App 内找到扫码领取入口，扫描上方二维码' },
  ],
}

const ClaimCopyBlockSection = defineComponent({
  name: 'ClaimCopyBlockSection',
  props: {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    blocks: { type: Array, default: () => [] },
    uploadingIndex: { type: Number, default: -1 },
  },
  emits: ['add', 'remove', 'move-up', 'move-down', 'upload', 'update-block'],
  setup(props, { emit, slots }) {
    function getImagePreview(url) {
      if (!url) return ''
      return String(url).startsWith('http') ? url : `${API_BASE_URL}${url}`
    }

    function handleImagePick(index, event) {
      const file = event?.target?.files?.[0]
      event.target.value = ''
      if (!file) return
      emit('upload', index, file)
    }

    return () => h(Card, { class: 'shadow-none ring-1' }, {
      default: () => [
        h(CardHeader, null, {
          default: () => [
            h('div', { class: 'flex flex-wrap items-start justify-between gap-3' }, [
              h('div', null, [
                h(CardTitle, { class: 'text-base' }, () => props.title),
                props.description ? h(CardDescription, null, () => props.description) : null,
              ]),
              h('div', { class: 'flex flex-wrap gap-2' }, [
                slots.actions?.(),
                h(Button, {
                  type: 'button',
                  variant: 'outline',
                  size: 'sm',
                  onClick: () => emit('add', 'text'),
                }, () => [h(Type, { class: 'mr-1 size-4' }), '文字']),
                h(Button, {
                  type: 'button',
                  variant: 'outline',
                  size: 'sm',
                  onClick: () => emit('add', 'image'),
                }, () => [h(ImagePlus, { class: 'mr-1 size-4' }), '图片']),
                h(Button, {
                  type: 'button',
                  variant: 'outline',
                  size: 'sm',
                  onClick: () => emit('add', 'link'),
                }, () => [h(Link2, { class: 'mr-1 size-4' }), '链接']),
              ]),
            ]),
          ],
        }),
        h(CardContent, { class: 'flex flex-col gap-4' }, {
          default: () => {
            if (!props.blocks.length) {
              return h('p', { class: 'text-sm text-muted-foreground' }, '暂无内容块，请添加文字、图片或链接。')
            }
            return props.blocks.map((block, index) => h('div', {
              key: `${block.type}-${index}`,
              class: 'rounded-lg border border-border p-4',
            }, [
              h('div', { class: 'mb-3 flex flex-wrap items-center justify-between gap-2' }, [
                h('span', { class: 'text-sm font-medium text-foreground' }, block.type === 'text' ? '文字' : block.type === 'image' ? '图片' : '链接'),
                h('div', { class: 'flex items-center gap-1' }, [
                  h(Button, {
                    type: 'button',
                    variant: 'ghost',
                    size: 'icon',
                    disabled: index === 0,
                    'aria-label': '上移',
                    onClick: () => emit('move-up', index),
                  }, () => h(ArrowUp, { class: 'size-4' })),
                  h(Button, {
                    type: 'button',
                    variant: 'ghost',
                    size: 'icon',
                    disabled: index === props.blocks.length - 1,
                    'aria-label': '下移',
                    onClick: () => emit('move-down', index),
                  }, () => h(ArrowDown, { class: 'size-4' })),
                  h(Button, {
                    type: 'button',
                    variant: 'ghost',
                    size: 'icon',
                    'aria-label': '删除',
                    onClick: () => emit('remove', index),
                  }, () => h(Trash2, { class: 'size-4' })),
                ]),
              ]),
              block.type === 'text'
                ? h(Textarea, {
                    modelValue: block.content,
                    rows: 3,
                    maxlength: 1000,
                    placeholder: '支持 {platform} 占位符',
                    'onUpdate:modelValue': (value) => emit('update-block', index, { content: value }),
                  })
                : null,
              block.type === 'image'
                ? h('div', { class: 'flex flex-col gap-3' }, [
                    block.url
                      ? h('img', {
                          src: getImagePreview(block.url),
                          alt: block.alt || '说明图片',
                          class: 'max-h-48 w-full rounded-md border border-border object-contain bg-muted/20',
                        })
                      : h('div', { class: 'rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground' }, '尚未上传图片'),
                    h('div', { class: 'grid gap-2' }, [
                      h(Label, null, () => '图片说明（可选）'),
                      h(Input, {
                        modelValue: block.alt || '',
                        maxlength: 120,
                        placeholder: '例如：App 下载示意图',
                        'onUpdate:modelValue': (value) => emit('update-block', index, { alt: value }),
                      }),
                    ]),
                    h('label', { class: 'inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground' }, [
                      h('input', {
                        type: 'file',
                        accept: 'image/*',
                        class: 'hidden',
                        onChange: (event) => handleImagePick(index, event),
                      }),
                      props.uploadingIndex === index ? '上传中…' : (block.url ? '更换图片' : '上传图片'),
                    ]),
                  ])
                : null,
              block.type === 'link'
                ? h('div', { class: 'grid gap-3' }, [
                    h('div', { class: 'grid gap-2' }, [
                      h(Label, null, () => '链接文字'),
                      h(Input, {
                        modelValue: block.label || '',
                        maxlength: 64,
                        placeholder: '例如：下载官方 App',
                        'onUpdate:modelValue': (value) => emit('update-block', index, { label: value }),
                      }),
                    ]),
                    h('div', { class: 'grid gap-2' }, [
                      h(Label, null, () => '链接地址'),
                      h(Input, {
                        modelValue: block.url || '',
                        maxlength: 512,
                        placeholder: 'https://',
                        'onUpdate:modelValue': (value) => emit('update-block', index, { url: value }),
                      }),
                    ]),
                  ])
                : null,
            ]))
          },
        }),
      ],
    })
  },
})

function applyForm(data) {
  form.list_visible = !!data?.list_visible
  form.sheet_guide_visible = !!data?.sheet_guide_visible
  form.guide_title = data?.guide_title || ''
  form.list_blocks = Array.isArray(data?.list_blocks)
    ? data.list_blocks.map((block) => ({ ...block }))
    : []
  form.sheet_blocks = Array.isArray(data?.sheet_blocks)
    ? data.sheet_blocks.map((block) => ({ ...block }))
    : []
}

function createBlock(type) {
  if (type === 'image') return { type: 'image', url: '', alt: '' }
  if (type === 'link') return { type: 'link', label: '', url: '' }
  return { type: 'text', content: '' }
}

function addBlock(field, type) {
  const blocks = form[field]
  if (blocks.length >= 20) {
    showPageWarning('每个区域最多 20 个内容块')
    return
  }
  blocks.push(createBlock(type))
}

function removeBlock(field, index) {
  form[field].splice(index, 1)
}

function moveBlock(field, index, delta) {
  const blocks = form[field]
  const target = index + delta
  if (target < 0 || target >= blocks.length) return
  const [item] = blocks.splice(index, 1)
  blocks.splice(target, 0, item)
}

function updateBlock(field, index, patch) {
  Object.assign(form[field][index], patch)
}

function copyListBlocksToSheet() {
  form.sheet_blocks = form.list_blocks.map((block) => ({ ...block }))
}

function extractUploadUrl(response) {
  if (response?.url) return response.url
  if (response?.data?.url) return response.data.url
  if (response?.path) return response.path
  if (typeof response?.data === 'string') return response.data
  return ''
}

async function uploadBlockImage(field, index, file) {
  const uploadingRef = field === 'list_blocks' ? uploadingListIndex : uploadingSheetIndex
  uploadingRef.value = index
  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)
    const formData = new FormData()
    formData.append('file', processedFile)
    const { data } = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const imageUrl = extractUploadUrl(data)
    if (!imageUrl) throw new Error('上传成功但未返回图片地址')
    updateBlock(field, index, { url: imageUrl })
    showPageSuccess('图片上传成功')
  } catch (error) {
    showPageWarning(error?.response?.data?.error || error?.message || '图片上传失败')
  } finally {
    uploadingRef.value = -1
  }
}

async function loadConfig() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await axios.get('/digital-claim-copy/admin')
    applyForm(data)
    forceHidden.value = !!data?.force_hidden
  } catch (error) {
    loadError.value = error?.response?.data?.error || error?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function resetToDefault() {
  applyForm(DEFAULT_FORM)
}

async function saveConfig() {
  saving.value = true
  try {
    const payload = {
      list_visible: form.list_visible,
      sheet_guide_visible: form.sheet_guide_visible,
      guide_title: form.guide_title.trim(),
      list_blocks: form.list_blocks,
      sheet_blocks: form.sheet_blocks,
    }
    const { data } = await axios.put('/digital-claim-copy', payload)
    applyForm(data?.data || payload)
    showPageSuccess(data?.message || '保存成功')
  } catch (error) {
    showPageWarning(error?.response?.data?.error || error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>
