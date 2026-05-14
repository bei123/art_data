<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        艺术品管理
      </h2>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" :disabled="loading" @click="refreshData">
          {{ loading ? '刷新中…' : '刷新数据' }}
        </Button>
        <Button
          v-if="isAdmin"
          variant="outline"
          :disabled="loading || wmsSyncing"
          class="gap-1.5"
          @click="openWmsSyncDialog"
        >
          <RefreshCw
            class="size-4 shrink-0"
            :class="{ 'animate-spin': wmsSyncing }"
            aria-hidden="true"
          />
          {{ wmsSyncing ? 'WMS 同步中…' : '从 WMS 同步' }}
        </Button>
        <Button @click="showAddDialog">
          添加艺术品
        </Button>
      </div>
    </div>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 pt-6">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
          <div class="relative min-w-0 flex-1 lg:max-w-xl">
            <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              v-model="searchKeyword"
              class="pl-9"
              placeholder="搜索艺术品标题、描述或艺术家名称"
              @keyup.enter="handleSearch"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <Button :disabled="loading" @click="handleSearch">
              搜索
            </Button>
            <Button v-if="searchKeyword" variant="outline" @click="handleClearSearch">
              清除搜索
            </Button>
          </div>
        </div>
        <Alert v-if="isSearchMode && !loading">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>搜索结果</AlertTitle>
          <AlertDescription>
            搜索「{{ searchKeyword }}」共找到 {{ pagination.total }} 条记录
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <Alert v-if="listError && !loading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchArtworks">
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
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[1040px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 px-3 text-left font-medium">标题</th>
              <th class="h-10 w-28 px-3 text-left font-medium">图片</th>
              <th class="h-10 px-3 text-left font-medium">艺术家</th>
              <th class="h-10 w-20 px-3 text-left font-medium">年份</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">价格</th>
              <th class="h-10 min-w-[7rem] px-3 text-left font-medium">库存/销量</th>
              <th class="h-10 min-w-[10rem] px-3 text-left font-medium">公开</th>
              <th class="h-10 w-24 px-3 text-left font-medium">状态</th>
              <th class="h-10 w-44 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in artworks"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
            >
              <td class="max-w-[14rem] truncate px-3 py-2.5 font-medium" :title="row.title">{{ row.title }}</td>
              <td class="px-3 py-2">
                <button
                  type="button"
                  class="relative size-20 overflow-hidden rounded-md border border-border bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="row.title ? `预览：${row.title}` : '预览图片'"
                  @click="openImagePreview(row.image, row.title)"
                >
                  <img
                    :src="row.image"
                    :alt="row.title ? `原作：${row.title}` : '原作缩略图'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.3' }"
                  >
                </button>
              </td>
              <td class="px-3 py-2.5">{{ row.artist_name }}</td>
              <td class="px-3 py-2.5 tabular-nums">{{ row.year }}</td>
              <td class="px-3 py-2.5">
                <template v-if="row.discount_price && row.discount_price < row.original_price">
                  <span class="mr-2 text-muted-foreground line-through">¥{{ row.original_price }}</span>
                  <span class="font-semibold text-destructive">¥{{ row.discount_price }}</span>
                </template>
                <span v-else>¥{{ row.original_price }}</span>
              </td>
              <td class="px-3 py-2.5 text-muted-foreground">
                <div>库存: {{ row.stock }}</div>
                <div>销量: {{ row.sales }}</div>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    type="button"
                    :variant="Number(row.is_public) !== 0 ? 'default' : 'outline'"
                    class="h-8"
                    :disabled="artworkIsPublicUpdatingId === row.id"
                    @click="handleArtworkListPublicChange(row, 1)"
                  >
                    公开
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    :variant="Number(row.is_public) === 0 ? 'default' : 'outline'"
                    class="h-8"
                    :disabled="artworkIsPublicUpdatingId === row.id"
                    @click="handleArtworkListPublicChange(row, 0)"
                  >
                    仅后台
                  </Button>
                  <Loader2
                    v-if="artworkIsPublicUpdatingId === row.id"
                    class="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </td>
              <td class="px-3 py-2.5">
                <Badge :variant="row.is_on_sale ? 'default' : 'secondary'">
                  {{ row.is_on_sale ? '在售' : '下架' }}
                </Badge>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" @click="editArtwork(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" @click="openDeleteOriginalArtworkDialog(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="artworks.length === 0 && !loading">
              <td colspan="9" class="px-3 py-12 text-center text-muted-foreground">
                暂无原作数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span v-if="isSearchMode" class="text-sm text-muted-foreground">
          搜索结果：共 {{ pagination.total }} 条
        </span>
        <span v-else class="text-sm text-muted-foreground">共 {{ pagination.total }} 条</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground">每页</span>
          <Select
            :model-value="String(pagination.pageSize)"
            @update:model-value="(v) => handleSizeChange(Number(v))"
          >
            <SelectTrigger class="h-8 w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            :disabled="pagination.page <= 1"
            @click="handleCurrentChange(pagination.page - 1)"
          >
            上一页
          </Button>
          <span class="min-w-[5rem] text-center text-sm tabular-nums">
            {{ pagination.page }} / {{ totalPages }}
          </span>
          <Button
            size="sm"
            variant="outline"
            :disabled="pagination.page >= totalPages"
            @click="handleCurrentChange(pagination.page + 1)"
          >
            下一页
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{{ dialogType === 'add' ? '添加艺术品' : '编辑艺术品' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="oa-title">标题 <span class="text-destructive">*</span></Label>
            <Input id="oa-title" v-model="form.title" autocomplete="off" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>图片 <span class="text-destructive">*</span></Label>
            <input
              ref="dialogImageInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onDialogImageInputChange"
            >
            <div
              class="relative max-w-[200px] cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
              :class="{ 'border-primary/50 bg-primary/5': isDragOver, 'pointer-events-none opacity-70': isUploading }"
              role="button"
              tabindex="0"
              @click="triggerDialogImageSelect"
              @keydown.enter.prevent="triggerDialogImageSelect"
              @keydown.space.prevent="triggerDialogImageSelect"
              @dragenter="handleDragEnter"
              @dragleave="handleDragLeave"
              @dragover="handleDragOver"
              @drop="handleDrop"
            >
              <img
                v-if="form.image"
                :src="form.image"
                alt="预览"
                class="block size-[178px] object-cover"
                loading="lazy"
              >
              <div v-else class="flex min-h-[178px] flex-col items-center justify-center gap-2 p-4 text-center">
                <Plus class="size-8 text-muted-foreground" aria-hidden="true" />
                <p class="text-sm font-medium text-foreground">点击或拖拽图片到此处上传</p>
                <p class="text-xs text-muted-foreground">支持 JPG、PNG、GIF，不超过 50MB</p>
              </div>
              <div
                v-if="isDragOver"
                class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 font-semibold text-primary"
              >
                <Upload class="mb-2 size-10" aria-hidden="true" />
                <p>释放鼠标上传图片</p>
              </div>
            </div>
            <div v-if="uploadProgress > 0" class="max-w-md rounded-lg border border-border bg-muted/40 p-3">
              <Progress :model-value="uploadProgress" class="h-2" />
              <p class="mt-2 text-center text-sm text-muted-foreground">
                <span v-if="uploadProgress < 100">正在上传图片... {{ uploadProgress }}%</span>
                <span v-else class="font-medium text-primary">上传完成！</span>
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>详情富文本</Label>
            <div class="overflow-hidden rounded-lg border border-border">
              <Toolbar :editor="editorRef" class="w-full border-b border-border" />
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
                class="min-h-[300px] w-full min-w-0"
                style="min-height: 300px"
                @onCreated="handleEditorCreated"
              />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="oa-artist-filter">艺术家 <span class="text-destructive">*</span></Label>
            <Input
              id="oa-artist-filter"
              v-model="artistFilter"
              placeholder="输入关键字筛选艺术家"
              class="max-w-md"
            />
            <select
              id="oa-artist"
              v-model="form.artist_id"
              class="flex h-10 w-full max-w-md rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option disabled value="">
                请选择艺术家
              </option>
              <option v-for="a in filteredArtistOptions" :key="a.id" :value="a.id">
                {{ a.name }}
              </option>
            </select>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="oa-year">年份</Label>
            <Input id="oa-year" v-model="form.year" type="number" class="max-w-xs" />
          </div>

          <div class="flex items-center gap-4 py-1">
            <Separator class="flex-1" />
            <span class="shrink-0 text-sm text-muted-foreground">价格和库存信息</span>
            <Separator class="flex-1" />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="oa-price">原价</Label>
              <Input
                id="oa-price"
                v-model.number="form.original_price"
                type="number"
                min="0"
                step="0.01"
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="oa-discount">折扣价</Label>
              <Input
                id="oa-discount"
                v-model.number="form.discount_price"
                type="number"
                min="0"
                step="0.01"
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="oa-stock">库存</Label>
              <Input id="oa-stock" v-model.number="form.stock" type="number" min="0" step="1" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="oa-sales">销量</Label>
              <Input id="oa-sales" v-model.number="form.sales" type="number" disabled class="opacity-70" />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>状态</Label>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                :variant="form.is_on_sale === 1 ? 'default' : 'outline'"
                @click="form.is_on_sale = 1"
              >
                在售
              </Button>
              <Button
                type="button"
                size="sm"
                :variant="form.is_on_sale === 0 ? 'default' : 'outline'"
                @click="form.is_on_sale = 0"
              >
                下架
              </Button>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>公开接口展示</Label>
            <p class="text-xs text-muted-foreground">
              关闭后未登录访客无法在列表、详情与搜索中看到该作品；若艺术家为「不展示」，作品也不会出现在公开接口。
            </p>
            <div class="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                :variant="form.is_public === 1 ? 'default' : 'outline'"
                @click="form.is_public = 1"
              >
                展示
              </Button>
              <Button
                type="button"
                size="sm"
                :variant="form.is_public === 0 ? 'default' : 'outline'"
                @click="form.is_public = 0"
              >
                不展示
              </Button>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="oa-desc">描述</Label>
            <Textarea id="oa-desc" v-model="form.description" class="min-h-24" rows="4" />
          </div>

          <div class="flex items-center gap-4 py-1">
            <Separator class="flex-1" />
            <span class="shrink-0 text-sm text-muted-foreground">收藏信息</span>
            <Separator class="flex-1" />
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="oa-cert">证书编号</Label>
              <Input id="oa-cert" v-model="form.collection_number" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="oa-size">作品尺寸</Label>
              <Input id="oa-size" v-model="form.collection_size" />
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <Label for="oa-material">作品材质</Label>
              <Input id="oa-material" v-model="form.collection_material" />
            </div>
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" @click="submitForm">
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="wmsSyncDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>从 WMS 同步</DialogTitle>
          <DialogDescription>
            与 WMS 列表分页一致；页数 × 每页条数为单次最多处理的列表行数上限（详情仍逐条拉取）。
          </DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-4 py-2">
          <div class="space-y-2">
            <Label for="wms-sync-max-pages">最大列表页数</Label>
            <Input
              id="wms-sync-max-pages"
              v-model.number="wmsSyncMaxPages"
              type="number"
              min="1"
              max="500"
              class="max-w-[160px]"
              :disabled="wmsSyncing"
              aria-describedby="wms-sync-max-pages-hint"
            />
            <p id="wms-sync-max-pages-hint" class="text-xs text-muted-foreground">
              服务端允许 1–500，默认 20。
            </p>
          </div>
          <div class="space-y-2">
            <Label for="wms-sync-page-size">WMS 每页条数</Label>
            <Input
              id="wms-sync-page-size"
              v-model.number="wmsSyncPageSize"
              type="number"
              min="1"
              max="100"
              class="max-w-[160px]"
              :disabled="wmsSyncing"
              aria-describedby="wms-sync-page-size-hint"
            />
            <p id="wms-sync-page-size-hint" class="text-xs text-muted-foreground">
              服务端允许 1–100，默认 20；调大可减少请求次数。
            </p>
          </div>
          <div class="space-y-2">
            <Label for="wms-sync-detail-concurrency">详情并发数</Label>
            <Input
              id="wms-sync-detail-concurrency"
              v-model.number="wmsSyncDetailConcurrency"
              type="number"
              min="1"
              max="10"
              class="max-w-[160px]"
              :disabled="wmsSyncing"
              aria-describedby="wms-sync-detail-concurrency-hint"
            />
            <p id="wms-sync-detail-concurrency-hint" class="text-xs text-muted-foreground">
              同时拉取详情的请求数，服务端允许 1–10，默认 3。
            </p>
          </div>
        </div>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" :disabled="wmsSyncing" @click="wmsSyncDialogOpen = false">
            取消
          </Button>
          <Button type="button" :disabled="wmsSyncing" @click="confirmSyncFromWms">
            <Loader2 v-if="wmsSyncing" class="mr-2 size-4 shrink-0 animate-spin" aria-hidden="true" />
            {{ wmsSyncing ? '同步中…' : '开始同步' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="previewOpen">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{{ previewTitle || '图片预览' }}</DialogTitle>
        </DialogHeader>
        <img
          v-if="previewSrc"
          :src="previewSrc"
          :alt="previewTitle || '预览'"
          class="max-h-[75vh] w-full object-contain"
        >
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="deleteOriginalArtworkDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除艺术品</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这个艺术品吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingOriginalArtwork"
            @click="confirmDeleteOriginalArtwork"
          >
            <Loader2 v-if="deletingOriginalArtwork" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Plus, RefreshCw, Search, Upload } from 'lucide-vue-next'
import axios from '../utils/axios'  // 使用封装的axios实例
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { userMatchesRole } from '@/utils/roles'
import { uploadImageToWebpLimit5MB } from '../utils/image'
import { API_BASE_URL } from '../config'
import '@wangeditor/editor/dist/css/style.css'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

const router = useRouter()
const userStore = useUserStore()
const isAdmin = computed(() => userMatchesRole(userStore.userInfo, 'admin'))
const artworks = ref([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const loading = ref(false)
const wmsSyncing = ref(false)
const wmsSyncDialogOpen = ref(false)
const wmsSyncMaxPages = ref(20)
const wmsSyncPageSize = ref(20)
const wmsSyncDetailConcurrency = ref(3)
const listError = ref('')
const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0
})

const deleteOriginalArtworkDialogOpen = ref(false)
const deleteOriginalArtworkTarget = ref(null)
const deletingOriginalArtwork = ref(false)

const artworkIsPublicUpdatingId = ref(null)

const totalPages = computed(() =>
  Math.max(1, Math.ceil((pagination.value.total || 0) / (pagination.value.pageSize || 20)))
)

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
  sales: 0,
  is_on_sale: 1,
  description: '',
  collection_number: '',
  collection_size: '',
  collection_material: '',
  is_public: 1
})

const dialogImageInput = ref(null)
const artistFilter = ref('')
const previewOpen = ref(false)
const previewSrc = ref('')
const previewTitle = ref('')

// 拖拽上传相关状态
const isDragOver = ref(false)
const uploadProgress = ref(0)
const isUploading = ref(false)

const artistOptions = ref([])

const filteredArtistOptions = computed(() => {
  const q = artistFilter.value.trim().toLowerCase()
  if (!q) return artistOptions.value
  return artistOptions.value.filter((a) =>
    String(a.name ?? '')
      .toLowerCase()
      .includes(q)
  )
})

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
    collection_material: '',
    is_public: 1
  }
  
  // 重置富文本编辑器内容
  longDescriptionHtml.value = ''
  
  // 重置拖拽上传状态
  isDragOver.value = false
  uploadProgress.value = 0
  isUploading.value = false
  artistFilter.value = ''

  // 确保富文本编辑器内容被清空
  nextTick(() => {
    if (editorRef.value && editorRef.value.setHtml) {
      editorRef.value.setHtml('')
    }
  })
}

function validateArtworkForm() {
  if (!form.value.title?.trim()) {
    ElMessage.error('请输入标题')
    return false
  }
  if (!form.value.image?.trim()) {
    ElMessage.error('请上传图片')
    return false
  }
  if (
    form.value.artist_id === '' ||
    form.value.artist_id === null ||
    form.value.artist_id === undefined
  ) {
    ElMessage.error('请选择艺术家')
    return false
  }
  const op = Number(form.value.original_price)
  if (Number.isNaN(op) || op < 0) {
    ElMessage.error('原价必须大于等于 0')
    return false
  }
  const dp = Number(form.value.discount_price)
  if (Number.isNaN(dp) || dp < 0) {
    ElMessage.error('折扣价必须大于等于 0')
    return false
  }
  const st = Number(form.value.stock)
  if (Number.isNaN(st) || st < 0) {
    ElMessage.error('库存必须大于等于 0')
    return false
  }
  return true
}

function extractUploadImageUrl(response) {
  if (!response) return ''
  if (response.url) return response.url
  if (response.data?.url) return response.data.url
  if (response.data && typeof response.data === 'string') return response.data
  if (typeof response === 'string') return response
  if (response.path) return response.path
  if (response.file) return response.file
  if (response.filename) return response.filename
  return ''
}

function openImagePreview(url, title) {
  if (!url) return
  const full = typeof url === 'string' && url.startsWith('http') ? url : `${API_BASE_URL}${url}`
  previewSrc.value = full
  previewTitle.value = title || ''
  previewOpen.value = true
}

function triggerDialogImageSelect() {
  dialogImageInput.value?.click?.()
}

function onDialogImageInputChange(e) {
  const input = e.target
  const file = input?.files?.[0]
  if (input) input.value = ''
  if (file) uploadDialogImageFile(file)
}

async function uploadDialogImageFile(file) {
  if (!file?.type?.startsWith('image/')) {
    ElMessage.error('只能上传图片文件')
    return
  }
  if (file.size / 1024 / 1024 >= 50) {
    ElMessage.error('图片大小不能超过 50MB')
    return
  }
  uploadProgress.value = 0
  isUploading.value = true
  try {
    const processed = await uploadImageToWebpLimit5MB(file)
    if (!processed) {
      ElMessage.error('图片处理失败')
      uploadProgress.value = 0
      isUploading.value = false
      return
    }
    const formData = new FormData()
    formData.append('file', processed)
    const response = await axios.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total)
          uploadProgress.value = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          )
        else uploadProgress.value = Math.min(uploadProgress.value + 10, 90)
      }
    })
    uploadProgress.value = 100
    const url = extractUploadImageUrl(response)
    if (url) {
      form.value.image = url
      ElMessage.success('图片上传成功')
    } else {
      ElMessage.error('图片上传失败：未获取到图片 URL')
    }
    setTimeout(() => {
      uploadProgress.value = 0
      isUploading.value = false
    }, 900)
  } catch (err) {
    console.error('uploadDialogImageFile', err)
    uploadProgress.value = 0
    isUploading.value = false
    ElMessage.error(err.response?.data?.message || err.message || '上传失败')
  }
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

const retryFetchArtworks = () => {
  listError.value = ''
  fetchArtworks()
}

const handleArtworkListPublicChange = async (row, nextPublic) => {
  if (!checkLoginStatus()) return
  const next = Number(nextPublic) === 0 ? 0 : 1
  if (Number(row.is_public) === next) return
  artworkIsPublicUpdatingId.value = row.id
  try {
    await axios.patch(`/original-artworks/${row.id}/is-public`, { is_public: next })
    const idx = artworks.value.findIndex((a) => a.id === row.id)
    if (idx >= 0) artworks.value[idx] = { ...artworks.value[idx], is_public: next }
    ElMessage.success(next === 1 ? '已设为公开' : '已设为仅后台')
  } catch (e) {
    const msg = e?.response?.data?.error || e?.response?.data?.message || '更新失败'
    ElMessage.error(typeof msg === 'string' ? msg : '更新失败')
  } finally {
    artworkIsPublicUpdatingId.value = null
  }
}

function resolveWmsSyncRequestBody() {
  const maxPages = Math.min(500, Math.max(1, parseInt(String(wmsSyncMaxPages.value), 10) || 20))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(wmsSyncPageSize.value), 10) || 20))
  const detailConcurrency = Math.min(10, Math.max(1, parseInt(String(wmsSyncDetailConcurrency.value), 10) || 3))
  return { maxPages, pageSize, detailConcurrency }
}

const openWmsSyncDialog = () => {
  if (!checkLoginStatus() || !isAdmin.value) return
  wmsSyncDialogOpen.value = true
}

/** 管理员：从 WMS 拉取列表与详情并 upsert（依赖服务端 WMS_HTTP_* 与库表 wms_record_id） */
const confirmSyncFromWms = async () => {
  if (!checkLoginStatus() || !isAdmin.value) return
  const body = resolveWmsSyncRequestBody()
  wmsSyncMaxPages.value = body.maxPages
  wmsSyncPageSize.value = body.pageSize
  wmsSyncDetailConcurrency.value = body.detailConcurrency
  wmsSyncing.value = true
  try {
    const data = await axios.post('/original-artworks/admin/sync-from-wms', body)
    const s = data?.stats
    if (s) {
      ElMessage.success(
        `同步完成：新建 ${s.inserted}，更新 ${s.updated}，未变 ${s.skipped_unchanged}，跳过 ${s.skipped_skip}，列表 ${s.listRows} 行 / ${s.pages} 页`
      )
      if (Array.isArray(s.errors) && s.errors.length > 0) {
        console.warn('WMS 同步部分错误', s.errors)
        ElMessage.warning(`有 ${s.errors.length} 条记录同步失败，详情见控制台`)
      }
    } else {
      ElMessage.success(data?.message || '同步已提交')
    }
    wmsSyncDialogOpen.value = false
    await fetchArtworks()
  } catch (e) {
    if (import.meta.env.DEV) console.error('WMS 同步失败', e?.response?.data || e)
    const msg = e?.response?.data?.error || e?.message || '同步失败'
    ElMessage.error(typeof msg === 'string' ? msg : '同步失败')
  } finally {
    wmsSyncing.value = false
  }
}

// 获取艺术品列表
const fetchArtworks = async () => {
  if (!checkLoginStatus()) return
  
  loading.value = true
  listError.value = ''
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
        is_public: Number(item.is_public) === 0 ? 0 : 1,
        year: Number(item.year) || new Date().getFullYear()
      }

      // 处理图片URL
      if (artwork.image && !artwork.image.startsWith('http')) {
        artwork.image = `${API_BASE_URL}${artwork.image}`
      }

      // 处理艺术家头像
      if (artwork.artist && artwork.artist.avatar && !artwork.artist.avatar.startsWith('http')) {
        artwork.artist.avatar = `${API_BASE_URL}${artwork.artist.avatar}`
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
    artworks.value = []
    if (error.response) {
      if (error.response.status === 401) {
        ElMessage.error('登录已过期，请重新登录')
        router.push('/login')
      } else {
        listError.value = `获取列表失败：${error.response.data?.message || error.response.statusText || '服务器错误'}`
      }
    } else if (error.request) {
      listError.value = '无法连接服务器，请检查网络后重试'
    } else {
      listError.value = `获取列表失败：${error.message || '未知错误'}`
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
      is_public: Number(detail.is_public) === 0 ? 0 : 1,
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
    artistFilter.value = ''
    dialogVisible.value = true
  } catch (error) {
    console.error('获取详细信息失败:', error)
    ElMessage.error('获取详细信息失败，无法编辑')
  }
}

function openDeleteOriginalArtworkDialog(row) {
  if (!checkLoginStatus()) return
  deleteOriginalArtworkTarget.value = row
  deleteOriginalArtworkDialogOpen.value = true
}

async function confirmDeleteOriginalArtwork() {
  const row = deleteOriginalArtworkTarget.value
  if (!row?.id) return
  if (!checkLoginStatus()) return
  deletingOriginalArtwork.value = true
  try {
    await axios.delete(`/original-artworks/${row.id}`)
    ElMessage.success('删除成功')
    deleteOriginalArtworkDialogOpen.value = false
    deleteOriginalArtworkTarget.value = null
    pagination.value.page = 1
    await fetchArtworks()
    scrollToTop()
  } catch (error) {
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
  } finally {
    deletingOriginalArtwork.value = false
  }
}

// 提交表单
const submitForm = async () => {
  if (!checkLoginStatus()) return
  if (!validateArtworkForm()) return

  try {
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
      is_public: Number(form.value.is_public) === 0 ? 0 : 1,
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
      ElMessage.error(error.message || '操作失败')
    }
  }
}

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
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) uploadDialogImageFile(f)
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
  editorRef.value = editor
  
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
        is_public: Number(item.is_public) === 0 ? 0 : 1,
        year: Number(item.year) || new Date().getFullYear(),
        artist_name: item.artist_name || ''
      }

      // 处理图片URL
      if (artwork.image && !artwork.image.startsWith('http')) {
        artwork.image = `${API_BASE_URL}${artwork.image}`
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
