<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-2">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        数字藏品领取说明
      </h2>
      <p class="text-sm text-muted-foreground">
        文案保存在服务端，小程序按需拉取。审核期间可关闭展示；支持 <code class="rounded bg-muted px-1">{platform}</code> 占位符（替换为作品发行方）。
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
            <p class="text-sm text-muted-foreground">点击「查看领取码」后弹层内的步骤说明</p>
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
        <CardTitle class="text-base">文案内容</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="grid gap-2">
          <Label for="guide-title">说明标题</Label>
          <Input id="guide-title" v-model="form.guide_title" maxlength="64" placeholder="数字藏品领取说明" />
        </div>

        <div class="grid gap-2">
          <Label for="guide-intro">引导说明</Label>
          <Textarea
            id="guide-intro"
            v-model="form.guide_intro"
            rows="3"
            maxlength="1000"
            placeholder="请使用「{platform}」官方 App 扫码领取..."
          />
        </div>

        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-2">
            <Label>操作步骤</Label>
            <Button type="button" variant="outline" size="sm" @click="addStep">
              添加步骤
            </Button>
          </div>
          <div v-if="form.guide_steps.length === 0" class="text-sm text-muted-foreground">
            暂无步骤，点击「添加步骤」。
          </div>
          <div v-for="(step, index) in form.guide_steps" :key="'step-' + index" class="flex items-start gap-2">
            <span class="mt-2 w-6 shrink-0 text-sm text-muted-foreground">{{ index + 1 }}.</span>
            <Textarea
              v-model="form.guide_steps[index]"
              rows="2"
              maxlength="200"
              class="min-h-[60px] flex-1"
              placeholder="步骤说明，可使用 {platform}"
            />
            <Button type="button" variant="ghost" size="icon" aria-label="删除步骤" @click="removeStep(index)">
              <Trash2 class="size-4" />
            </Button>
          </div>
        </div>

        <div class="grid gap-2">
          <Label for="sheet-tip">领取码弹层提示</Label>
          <Textarea
            id="sheet-tip"
            v-model="form.sheet_tip"
            rows="2"
            maxlength="512"
            placeholder="点击二维码可放大保存，打开「{platform}」扫码领取"
          />
        </div>
      </CardContent>
      <CardFooter class="flex flex-wrap gap-2 border-t border-border pt-6">
        <Button type="button" variant="outline" @click="resetToDefault">
          恢复默认文案
        </Button>
        <Button type="button" :disabled="saving" @click="saveConfig">
          <Loader2 v-if="saving" class="mr-2 size-4 animate-spin" aria-hidden="true" />
          {{ saving ? '保存中…' : '保存配置' }}
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { AlertCircle, Loader2, Trash2 } from 'lucide-vue-next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { showPageError, showPageSuccess } from '@/utils/appMessage'

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const forceHidden = ref(false)

const form = reactive({
  list_visible: false,
  sheet_guide_visible: false,
  guide_title: '',
  guide_intro: '',
  guide_steps: [],
  sheet_tip: '',
})

const DEFAULT_FORM = {
  list_visible: false,
  sheet_guide_visible: false,
  guide_title: '数字藏品领取说明',
  guide_intro:
    '请使用「{platform}」官方 App 扫码领取。如尚未安装，可在应用商店搜索「{platform}」下载。',
  guide_steps: [
    '在应用商店搜索并安装「{platform}」',
    '打开「{platform}」并登录账号（建议与购买时使用的手机号一致）',
    '点击「查看领取码」，保存或截图二维码（也可用另一台手机展示）',
    '在 App 内找到「扫码领取」「典藏领取」或类似入口，扫描领取二维码',
    '领取成功后，藏品将出现在您的账号藏品库中',
  ],
  sheet_tip: '点击二维码可放大保存，打开「{platform}」扫码领取',
}

function applyForm(data) {
  form.list_visible = !!data?.list_visible
  form.sheet_guide_visible = !!data?.sheet_guide_visible
  form.guide_title = data?.guide_title || ''
  form.guide_intro = data?.guide_intro || ''
  form.guide_steps = Array.isArray(data?.guide_steps) ? [...data.guide_steps] : []
  form.sheet_tip = data?.sheet_tip || ''
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

function addStep() {
  if (form.guide_steps.length >= 10) {
    showPageError('最多 10 条步骤')
    return
  }
  form.guide_steps.push('')
}

function removeStep(index) {
  form.guide_steps.splice(index, 1)
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
      guide_intro: form.guide_intro.trim(),
      guide_steps: form.guide_steps.map((step) => String(step || '').trim()).filter(Boolean),
      sheet_tip: form.sheet_tip.trim(),
    }
    const { data } = await axios.put('/digital-claim-copy', payload)
    applyForm(data?.data || payload)
    showPageSuccess(data?.message || '保存成功')
  } catch (error) {
    showPageError(error?.response?.data?.error || error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>
