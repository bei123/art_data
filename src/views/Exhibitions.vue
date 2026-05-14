<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div
      v-if="!isDetailMode"
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        展览管理
      </h2>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" :disabled="loadingList" @click="fetchExhibitions">
          <Loader2 v-if="loadingList" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          {{ loadingList ? '刷新中…' : '刷新数据' }}
        </Button>
        <Button type="button" @click="openAddDialog">
          添加展览
        </Button>
      </div>
    </div>

    <div
      v-else
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        展览作品管理
      </h2>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" @click="goBackToList">
          返回展览列表
        </Button>
        <Button type="button" variant="secondary" :disabled="loadingDetail" @click="fetchDetail(exhibitionId)">
          <Loader2 v-if="loadingDetail" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          {{ loadingDetail ? '刷新中…' : '刷新详情' }}
        </Button>
      </div>
    </div>

    <!-- 列表模式 -->
    <div v-if="!isDetailMode">
      <Alert v-if="listError && !loadingList" variant="destructive" class="mb-4">
        <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
        <AlertTitle>{{ listError }}</AlertTitle>
        <AlertDescription class="mt-2">
          <Button type="button" variant="secondary" size="sm" @click="retryFetchExhibitions">
            重试
          </Button>
        </AlertDescription>
      </Alert>

      <Card class="relative overflow-hidden shadow-none ring-1">
        <div
          v-if="loadingList"
          class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
          aria-busy="true"
          aria-label="加载中"
        >
          <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
        <CardContent class="overflow-x-auto p-0 sm:p-6">
          <table class="w-full min-w-[960px] text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/40">
                <th class="h-10 w-28 px-3 text-left font-medium">封面</th>
                <th class="h-10 min-w-[10rem] px-3 text-left font-medium">标题</th>
                <th class="h-10 w-28 px-3 text-left font-medium">状态</th>
                <th class="h-10 w-44 px-3 text-left font-medium">开始时间</th>
                <th class="h-10 w-44 px-3 text-left font-medium">结束时间</th>
                <th class="h-10 w-44 px-3 text-left font-medium">创建时间</th>
                <th class="h-10 w-52 px-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in exhibitions"
                :key="row.id"
                class="border-b border-border transition-colors hover:bg-muted/30"
              >
                <td class="px-3 py-2">
                  <div class="size-20 overflow-hidden rounded-md border border-border bg-muted/30">
                    <img
                      v-if="row.cover_image"
                      :src="getImageUrl(row.cover_image)"
                      :alt="row.title ? `展览封面：${row.title}` : '展览封面'"
                      class="size-full object-cover"
                      loading="lazy"
                      @error="(e) => { e.target.style.opacity = '0.35' }"
                    >
                    <div v-else class="flex size-full items-center justify-center text-xs text-muted-foreground">
                      —
                    </div>
                  </div>
                </td>
                <td class="px-3 py-2.5 font-medium">{{ row.title }}</td>
                <td class="px-3 py-2.5">
                  <Badge :variant="row.status === 'published' ? 'default' : 'secondary'">
                    {{ row.status === 'published' ? '已发布' : '草稿' }}
                  </Badge>
                </td>
                <td class="px-3 py-2.5 text-muted-foreground">
                  <span v-if="row.start_at">{{ row.start_at }}</span>
                  <span v-else>—</span>
                </td>
                <td class="px-3 py-2.5 text-muted-foreground">
                  <span v-if="row.end_at">{{ row.end_at }}</span>
                  <span v-else>—</span>
                </td>
                <td class="px-3 py-2.5 tabular-nums text-muted-foreground">{{ row.created_at }}</td>
                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" type="button" @click="openEditDialog(row)">
                      编辑
                    </Button>
                    <Button size="sm" type="button" @click="goToManageItems(row.id)">
                      管理作品
                    </Button>
                  </div>
                </td>
              </tr>
              <tr v-if="exhibitions.length === 0 && !loadingList">
                <td colspan="7" class="px-3 py-12 text-center text-muted-foreground">
                  暂无展览数据
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>

    <!-- 详情模式 -->
    <div v-else class="flex flex-col gap-4">
      <Alert v-if="detailError && !loadingDetail" variant="destructive">
        <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
        <AlertTitle>{{ detailError }}</AlertTitle>
        <AlertDescription class="mt-2">
          <Button type="button" variant="secondary" size="sm" @click="retryFetchDetail">
            重试
          </Button>
        </AlertDescription>
      </Alert>

      <Card v-if="exhibitionDetail" class="shadow-none ring-1">
        <CardHeader class="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div class="min-w-0 space-y-1">
            <CardTitle class="text-lg">
              {{ exhibitionDetail.exhibition?.title || '未命名展览' }}
            </CardTitle>
            <CardDescription class="flex flex-wrap items-center gap-2">
              <Badge :variant="exhibitionDetail.exhibition?.status === 'published' ? 'default' : 'secondary'">
                {{ exhibitionDetail.exhibition?.status === 'published' ? '已发布' : '草稿' }}
              </Badge>
              <span class="text-muted-foreground">
                创建时间：{{ exhibitionDetail.exhibition?.created_at || '—' }}
              </span>
            </CardDescription>
          </div>
          <Button size="sm" type="button" @click="openEditDialogFromDetail">
            编辑展览
          </Button>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 sm:flex-row">
          <div class="shrink-0">
            <div
              v-if="exhibitionDetail.exhibition?.cover_image"
              class="size-36 overflow-hidden rounded-lg border border-border bg-muted/30"
            >
              <img
                :src="getImageUrl(exhibitionDetail.exhibition.cover_image)"
                alt="展览封面"
                class="size-full object-cover"
                loading="lazy"
              >
            </div>
            <div
              v-else
              class="flex size-36 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
            >
              无封面
            </div>
          </div>
          <div class="min-w-0 flex-1 space-y-2 text-sm">
            <div>
              <span class="font-medium text-foreground">描述：</span>
              <span class="text-muted-foreground">{{ exhibitionDetail.exhibition?.description || '—' }}</span>
            </div>
            <div>
              <span class="font-medium text-foreground">开始时间：</span>
              <span class="text-muted-foreground">{{ exhibitionDetail.exhibition?.start_at || '—' }}</span>
            </div>
            <div>
              <span class="font-medium text-foreground">结束时间：</span>
              <span class="text-muted-foreground">{{ exhibitionDetail.exhibition?.end_at || '—' }}</span>
            </div>
            <div>
              <span class="font-medium text-foreground">作品数：</span>
              <span class="tabular-nums text-muted-foreground">
                {{ exhibitionDetail.items_total ?? exhibitionDetail.items?.length ?? 0 }}
              </span>
            </div>
            <div>
              <span class="font-medium text-foreground">现场图：</span>
              <span class="tabular-nums text-muted-foreground">
                {{ exhibitionDetail.live_photos_total ?? exhibitionDetail.live_photos?.length ?? 0 }} 张
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card v-if="exhibitionDetail" class="shadow-none ring-1">
        <CardHeader>
          <CardTitle class="text-base">
            展览现场图
            <span class="ml-2 font-normal text-muted-foreground">
              （{{ exhibitionDetail.live_photos?.length || 0 }} / {{ MAX_LIVE_PHOTOS }}）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div v-if="(exhibitionDetail.live_photos || []).length" class="flex flex-wrap gap-4">
            <div
              v-for="p in exhibitionDetail.live_photos"
              :key="p.id"
              class="group relative size-[120px] overflow-hidden rounded-lg border border-border shadow-sm"
            >
              <img :src="getImageUrl(p.image_url)" class="size-full object-cover" alt="现场图">
              <div
                class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  class="size-8"
                  @click="openDeleteLivePhotoDialog(p)"
                >
                  <Trash2 class="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>

          <div
            v-if="(exhibitionDetail.live_photos?.length || 0) < MAX_LIVE_PHOTOS"
            class="relative flex size-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
            :class="{
              'border-primary/50 bg-primary/5': isLivePhotosDragOver,
              'pointer-events-none opacity-70': isLivePhotosUploading || isLivePhotosProcessing,
            }"
            role="button"
            tabindex="0"
            @click="triggerLivePhotosInput"
            @keydown.enter.prevent="triggerLivePhotosInput"
            @keydown.space.prevent="triggerLivePhotosInput"
            @dragenter="handleLivePhotosDragEnter"
            @dragleave="handleLivePhotosDragLeave"
            @dragover="handleLivePhotosDragOver"
            @drop="handleLivePhotosDrop"
          >
            <Loader2
              v-if="isLivePhotosUploading || isLivePhotosProcessing"
              class="mb-1 size-8 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <Plus v-else class="mb-1 size-8 text-muted-foreground" aria-hidden="true" />
            <p class="px-1 text-center text-xs font-medium text-foreground">添加现场图</p>
            <p class="mt-0.5 px-1 text-center text-[10px] text-muted-foreground">
              最多 {{ MAX_LIVE_PHOTOS }} 张，支持拖拽多选
            </p>
          </div>

          <input
            ref="livePhotosInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="handleLivePhotosFileSelect"
          >

          <div v-if="isLivePhotosProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div class="mb-2 flex justify-between text-muted-foreground">
              <span>图片处理中</span>
              <span>处理中…</span>
            </div>
            <Progress :model-value="40" class="h-2" />
            <div class="mt-2 flex justify-between text-xs text-muted-foreground">
              <span class="max-w-[150px] truncate">{{ livePhotosFileName }}</span>
              <span>{{ formatFileSize(livePhotosFileSize) }}</span>
            </div>
            <p class="mt-2 text-center text-xs italic text-muted-foreground">
              正在将图片转换为 WebP 并压缩…
            </p>
          </div>

          <div
            v-if="livePhotosUploadProgress > 0 && livePhotosUploadProgress < 100 && !isLivePhotosProcessing"
            class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
          >
            <div class="mb-2 flex justify-between">
              <span class="font-medium">上传进度</span>
              <span class="font-semibold text-primary tabular-nums">{{ livePhotosUploadProgress }}%</span>
            </div>
            <Progress :model-value="livePhotosUploadProgress" class="h-2" />
            <div class="mt-2 flex justify-between text-xs text-muted-foreground">
              <span class="max-w-[150px] truncate">{{ livePhotosFileName }}</span>
              <span>{{ formatFileSize(livePhotosFileSize) }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div class="flex flex-wrap gap-2">
        <Button type="button" :disabled="!exhibitionDetail" @click="openItemsDialog">
          追加展览作品
        </Button>
      </div>

      <Card class="relative overflow-hidden shadow-none ring-1">
        <div
          v-if="loadingDetail"
          class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
          aria-busy="true"
          aria-label="加载中"
        >
          <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
        <CardContent class="overflow-x-auto p-0 sm:p-6">
          <table class="w-full min-w-[900px] text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/40">
                <th class="h-10 w-20 px-3 text-left font-medium">排序</th>
                <th class="h-10 w-28 px-3 text-left font-medium">类型</th>
                <th class="h-10 w-28 px-3 text-left font-medium">图片</th>
                <th class="h-10 min-w-[12rem] px-3 text-left font-medium">标题 / ID</th>
                <th class="h-10 min-w-[10rem] px-3 text-left font-medium">关联艺术家</th>
                <th class="h-10 w-52 px-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in exhibitionDetail?.items || []"
                :key="row.id"
                class="border-b border-border transition-colors hover:bg-muted/30"
              >
                <td class="px-3 py-2 tabular-nums text-muted-foreground">{{ row.sort_order }}</td>
                <td class="px-3 py-2.5">
                  <Badge :variant="row.artwork_type === 'digital' ? 'outline' : 'secondary'">
                    {{ row.artwork_type === 'digital' ? '数字' : '原作' }}
                  </Badge>
                </td>
                <td class="px-3 py-2">
                  <div class="size-20 overflow-hidden rounded-md border border-border bg-muted/30">
                    <img
                      v-if="row.artwork?.image"
                      :src="getImageUrl(row.artwork.image)"
                      alt=""
                      class="size-full object-cover"
                      loading="lazy"
                    >
                    <img
                      v-else-if="row.artwork?.image_url"
                      :src="getImageUrl(row.artwork.image_url)"
                      alt=""
                      class="size-full object-cover"
                      loading="lazy"
                    >
                    <div v-else class="flex size-full items-center justify-center text-xs text-muted-foreground">
                      —
                    </div>
                  </div>
                </td>
                <td class="px-3 py-2.5">
                  <div class="font-medium">{{ row.artwork?.title || '未知作品' }}</div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    item_id: {{ row.id }} / artwork_id: {{ row.artwork?.id || '—' }}
                  </div>
                </td>
                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap gap-1">
                    <Badge
                      v-for="a in (row.artists || [])"
                      :key="a.id"
                      variant="secondary"
                      class="font-normal"
                    >
                      {{ a.name }}
                    </Badge>
                    <span v-if="!(row.artists || []).length" class="text-muted-foreground">未关联</span>
                  </div>
                </td>
                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" type="button" @click="openEditArtistsDialog(row)">
                      编辑艺术家
                    </Button>
                    <Button size="sm" variant="destructive" type="button" @click="openRemoveItemDialog(row)">
                      移除
                    </Button>
                  </div>
                </td>
              </tr>
              <tr v-if="exhibitionDetail && !(exhibitionDetail.items || []).length && !loadingDetail">
                <td colspan="6" class="px-3 py-12 text-center text-muted-foreground">
                  暂无展览作品，可点击上方追加
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>

    <!-- 添加/编辑展览 -->
    <Dialog v-model:open="exhibitionDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ exhibitionDialogMode === 'add' ? '添加展览' : '编辑展览' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="ex-title">标题 <span class="text-destructive">*</span></Label>
            <Input id="ex-title" v-model="exhibitionForm.title" autocomplete="off" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="ex-desc">描述</Label>
            <Textarea id="ex-desc" v-model="exhibitionForm.description" class="min-h-24" rows="4" />
          </div>

          <div class="flex flex-col gap-2">
            <Label>封面图片</Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="exhibitionForm.cover_image"
                class="group relative size-[200px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img :src="getImageUrl(exhibitionForm.cover_image)" alt="封面" class="size-full object-cover">
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="removeCoverImage">
                    <Trash2 class="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" @click="triggerCoverInput">
                    更换图片
                  </Button>
                </div>
              </div>
              <div
                v-else
                class="relative flex size-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
                :class="{
                  'border-primary/50 bg-primary/5': isCoverDragOver,
                  'pointer-events-none opacity-70': isCoverUploading || isCoverProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerCoverInput"
                @keydown.enter.prevent="triggerCoverInput"
                @keydown.space.prevent="triggerCoverInput"
                @dragenter="handleCoverDragEnter"
                @dragleave="handleCoverDragLeave"
                @dragover="handleCoverDragOver"
                @drop="handleCoverDrop"
              >
                <Loader2
                  v-if="isCoverUploading || isCoverProcessing"
                  class="mb-2 size-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <Upload v-else class="mb-2 size-10 text-muted-foreground" aria-hidden="true" />
                <p class="px-2 text-center text-sm font-medium text-foreground">
                  {{ isCoverProcessing ? '正在处理图片…' : isCoverUploading ? '正在上传…' : '点击或拖拽图片到此处上传' }}
                </p>
                <p class="mt-1 px-2 text-center text-xs text-muted-foreground">
                  支持 JPG、PNG、GIF，自动转 WebP 并压缩至 5MB 以内
                </p>
                <div
                  v-if="isCoverDragOver && !exhibitionForm.cover_image"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-10" aria-hidden="true" />
                  <span>释放鼠标上传图片</span>
                </div>
              </div>
              <input
                ref="coverImageInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleCoverFileSelect"
              >
              <div v-if="isCoverProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div class="mb-2 flex justify-between text-muted-foreground">
                  <span>图片处理中</span>
                  <span>处理中…</span>
                </div>
                <Progress :model-value="40" class="h-2" />
              </div>
              <div
                v-if="coverUploadProgress > 0 && coverUploadProgress < 100 && !isCoverProcessing"
                class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
                <div class="mb-2 flex justify-between">
                  <span class="font-medium">上传进度</span>
                  <span class="font-semibold text-primary tabular-nums">{{ coverUploadProgress }}%</span>
                </div>
                <Progress :model-value="coverUploadProgress" class="h-2" />
              </div>
              <div v-if="coverUploadProgress === 100 && !isCoverProcessing" class="text-center text-sm text-primary">
                上传完成
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label for="ex-status">状态</Label>
            <select
              id="ex-status"
              v-model="exhibitionForm.status"
              class="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
            </select>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="ex-start">开始时间</Label>
              <Input id="ex-start" v-model="exhibitionForm.start_at" type="date" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="ex-end">结束时间</Label>
              <Input id="ex-end" v-model="exhibitionForm.end_at" type="date" />
            </div>
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="exhibitionDialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="savingExhibition" @click="submitExhibition">
            <Loader2 v-if="savingExhibition" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 追加展览作品 -->
    <Dialog v-model:open="itemsDialogVisible">
      <DialogContent class="max-h-[92vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>追加展览作品</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="item-type">作品类型</Label>
            <select
              id="item-type"
              v-model="itemDraft.artwork_type"
              class="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @change="handleArtworkTypeChange"
            >
              <option value="original">原作</option>
              <option value="digital">数字</option>
            </select>
          </div>

          <template v-if="itemDraft.artwork_type === 'original'">
            <div class="flex flex-col gap-2">
              <Label>选择作品（原作）</Label>
              <Input v-model="originalArtworkFilter" placeholder="筛选标题或 ID" class="max-w-xl" autocomplete="off" />
              <select
                v-model.number="itemDraft.artwork_id"
                class="flex h-36 w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                size="8"
              >
                <option :value="0" disabled>
                  请选择 original_artworks
                </option>
                <option v-for="a in filteredOriginalArtworks" :key="a.id" :value="a.id">
                  {{ a.title }} ({{ a.id }})
                </option>
              </select>
            </div>
          </template>
          <template v-else>
            <div class="flex flex-col gap-2">
              <Label>选择作品（数字）</Label>
              <Input v-model="digitalArtworkFilter" placeholder="筛选标题或 ID" class="max-w-xl" autocomplete="off" />
              <select
                v-model.number="itemDraft.artwork_id"
                class="flex h-36 w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                size="8"
              >
                <option :value="0" disabled>
                  请选择 digital_artworks_external
                </option>
                <option v-for="a in filteredDigitalArtworks" :key="a.id" :value="a.id">
                  {{ a.title }} ({{ a.id }})
                </option>
              </select>
            </div>
          </template>

          <div class="flex flex-col gap-2">
            <Label for="item-sort">排序 sort_order</Label>
            <Input
              id="item-sort"
              v-model.number="itemDraft.sort_order"
              type="number"
              min="1"
              step="1"
              class="max-w-xs"
            />
          </div>

          <div class="flex flex-col gap-2">
            <Label>关联艺术家（可选）</Label>
            <Input v-model="itemsArtistFilter" placeholder="筛选艺术家" class="max-w-xl" autocomplete="off" />
            <p class="text-xs text-muted-foreground">
              不选则自动使用该作品自带 artist_id；按住 Ctrl/Cmd 多选。
            </p>
            <select
              v-model="itemDraft.artists"
              multiple
              class="min-h-[140px] w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              size="8"
            >
              <option v-for="a in filteredArtistsForItems" :key="a.id" :value="a.id">
                {{ a.name }}
              </option>
            </select>
          </div>

          <Button type="button" :disabled="!itemDraft.artwork_id" @click="addDraftItem">
            加入待提交列表
          </Button>
        </div>

        <div class="mt-2 border-t border-border pt-4">
          <p class="mb-2 text-sm text-muted-foreground">待提交 items（将作为一次请求提交）</p>
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full min-w-[640px] text-sm">
              <thead>
                <tr class="border-b border-border bg-muted/40">
                  <th class="h-9 px-2 text-left font-medium">排序</th>
                  <th class="h-9 w-24 px-2 text-left font-medium">类型</th>
                  <th class="h-9 min-w-[12rem] px-2 text-left font-medium">作品</th>
                  <th class="h-9 min-w-[10rem] px-2 text-left font-medium">关联艺术家</th>
                  <th class="h-9 w-24 px-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in pendingItems" :key="idx" class="border-b border-border">
                  <td class="px-2 py-2">
                    <Input v-model.number="row.sort_order" type="number" min="1" step="1" class="h-8 w-24" />
                  </td>
                  <td class="px-2 py-2">
                    <Badge :variant="row.artwork_type === 'digital' ? 'outline' : 'secondary'">
                      {{ row.artwork_type === 'digital' ? '数字' : '原作' }}
                    </Badge>
                  </td>
                  <td class="px-2 py-2">
                    <div class="font-medium">{{ getPendingArtworkTitle(row) }}</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">artwork_id: {{ row.artwork_id }}</div>
                  </td>
                  <td class="px-2 py-2 text-muted-foreground">
                    <span v-if="row.artists && row.artists.length">{{ getPendingArtistNames(row.artists).join(', ') }}</span>
                    <span v-else>自动匹配</span>
                  </td>
                  <td class="px-2 py-2">
                    <Button size="sm" variant="destructive" type="button" @click="removePendingItem(idx)">
                      移除
                    </Button>
                  </td>
                </tr>
                <tr v-if="pendingItems.length === 0">
                  <td colspan="5" class="px-3 py-10 text-center text-muted-foreground">
                    暂无待提交项，请在上方选择作品后加入
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="itemsDialogVisible = false">
            取消
          </Button>
          <Button
            type="button"
            :disabled="pendingItems.length === 0 || savingItems"
            @click="submitItems"
          >
            <Loader2 v-if="savingItems" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 编辑作品-艺术家 -->
    <Dialog v-model:open="editArtistsDialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑作品-艺术家关联</DialogTitle>
        </DialogHeader>

        <div class="grid gap-3 py-2">
          <p class="text-sm text-muted-foreground">item_id: {{ editArtistsItemId }}</p>
          <div class="flex flex-col gap-2">
            <Label>艺术家</Label>
            <Input v-model="editArtistFilter" placeholder="筛选艺术家" autocomplete="off" />
            <select
              v-model="editArtistsDraftArtistIds"
              multiple
              class="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              size="10"
            >
              <option v-for="a in filteredArtistsForEdit" :key="a.id" :value="a.id">
                {{ a.name }}
              </option>
            </select>
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="editArtistsDialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="savingArtists" @click="submitArtists">
            <Loader2 v-if="savingArtists" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 移除展览作品确认 -->
    <AlertDialog v-model:open="removeItemDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除展览作品</AlertDialogTitle>
          <AlertDialogDescription>
            确定从本展览中移除「{{ removeItemArtworkTitle }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="removingItem"
            @click="confirmRemoveItem"
          >
            <Loader2 v-if="removingItem" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            移除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 删除现场图确认 -->
    <AlertDialog v-model:open="deleteLivePhotoDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除现场图</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除这张现场图吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingLivePhoto"
            @click="confirmDeleteLivePhotoSubmit"
          >
            <Loader2 v-if="deletingLivePhoto" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from '../utils/axios'
import { API_BASE_URL, isOssPublicUrl } from '../config'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Plus, Trash2, Upload } from 'lucide-vue-next'
import { uploadImageToWebpLimit5MB } from '../utils/image'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

const route = useRoute()
const router = useRouter()

const loadingList = ref(false)
const loadingDetail = ref(false)
const listError = ref('')
const detailError = ref('')
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

const coverImageInput = ref(null)
const isCoverUploading = ref(false)
const isCoverProcessing = ref(false)
const coverUploadProgress = ref(0)
const isCoverDragOver = ref(false)

const originalArtworkFilter = ref('')
const digitalArtworkFilter = ref('')
const itemsArtistFilter = ref('')
const editArtistFilter = ref('')

const getImageUrl = (url) => {
  if (!url) return ''
  if (isOssPublicUrl(url)) return url
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

const isDetailMode = computed(() => !!route.params.id)
const exhibitionId = computed(() => (route.params.id ? Number(route.params.id) : null))

const removeItemDialogOpen = ref(false)
const removeItemTarget = ref(null)
const removingItem = ref(false)

const deleteLivePhotoDialogOpen = ref(false)
const deleteLivePhotoTarget = ref(null)
const deletingLivePhoto = ref(false)

const removeItemArtworkTitle = computed(() => {
  const row = removeItemTarget.value
  if (!row) return '该作品'
  return row.artwork?.title || '未知作品'
})

const exhibitionDialogVisible = ref(false)
const exhibitionDialogMode = ref('add')
const exhibitionForm = reactive({
  id: null,
  title: '',
  description: '',
  cover_image: '',
  status: 'draft',
  start_at: '',
  end_at: '',
})

function toDateTimeInputValue(v) {
  if (!v) return ''
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

function resetCoverUploadState() {
  coverUploadProgress.value = 0
  isCoverUploading.value = false
  isCoverProcessing.value = false
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

function triggerCoverInput() {
  if (!isCoverUploading.value && !isCoverProcessing.value) coverImageInput.value?.click()
}

function handleCoverFileSelect(event) {
  const file = event.target.files?.[0]
  if (file) uploadCoverFile(file)
  event.target.value = ''
}

async function uploadCoverFile(file) {
  if (!file?.type?.startsWith('image/')) {
    ElMessage.error('只能上传图片文件！')
    return
  }

  coverUploadProgress.value = 0
  isCoverDragOver.value = false
  isCoverProcessing.value = true
  isCoverUploading.value = true

  const processedFile = await uploadImageToWebpLimit5MB(file)
  if (!processedFile) {
    resetCoverUploadState()
    return
  }

  isCoverProcessing.value = false
  coverUploadProgress.value = 0

  const formData = new FormData()
  formData.append('file', processedFile)

  try {
    const resp = await axios.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          coverUploadProgress.value = Math.round((progressEvent.loaded * 100) / progressEvent.total)
        } else {
          coverUploadProgress.value = Math.min(coverUploadProgress.value + 10, 90)
        }
      },
    })

    coverUploadProgress.value = 100
    const url = extractUploadedUrl(resp)
    if (url) {
      exhibitionForm.cover_image = url
      ElMessage.success('封面上传成功')
    } else {
      ElMessage.error('封面上传失败：未获取到图片URL')
    }
    setTimeout(() => {
      coverUploadProgress.value = 0
    }, 1200)
  } catch (err) {
    console.error('cover upload error:', err)
    ElMessage.error('封面上传失败')
    coverUploadProgress.value = 0
  } finally {
    isCoverUploading.value = false
    isCoverProcessing.value = false
  }
}

function removeCoverImage() {
  exhibitionForm.cover_image = ''
  resetCoverUploadState()
}

function handleCoverDragEnter(e) {
  e.preventDefault()
  e.stopPropagation()
  isCoverDragOver.value = true
}

function handleCoverDragLeave(e) {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) isCoverDragOver.value = false
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
  const file = e.dataTransfer?.files?.[0]
  if (file?.type?.startsWith('image/')) uploadCoverFile(file)
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
  if (!isLivePhotosUploading.value && !isLivePhotosProcessing.value) livePhotosInput.value?.click()
}

function handleLivePhotosFileSelect(event) {
  const files = Array.from(event.target.files || [])
  if (files.length > 0) uploadLivePhotosFiles(files)
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
      `现场图最多 ${MAX_LIVE_PHOTOS} 张，当前 ${current} 张，还可添加 ${MAX_LIVE_PHOTOS - current} 张`,
    )
    return
  }

  isLivePhotosUploading.value = true
  isLivePhotosProcessing.value = true

  const urls = []

  for (const file of imageFiles) {
    try {
      const processedFile = await uploadImageToWebpLimit5MB(file)
      if (!processedFile) continue

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
        },
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
  if (!e.currentTarget.contains(e.relatedTarget)) isLivePhotosDragOver.value = false
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
  if (dropped.length > 0) uploadLivePhotosFiles(dropped)
}

function openDeleteLivePhotoDialog(p) {
  if (!exhibitionId.value || !p?.id) return
  deleteLivePhotoTarget.value = p
  deleteLivePhotoDialogOpen.value = true
}

async function confirmDeleteLivePhotoSubmit() {
  const p = deleteLivePhotoTarget.value
  if (!exhibitionId.value || !p?.id) return
  deletingLivePhoto.value = true
  try {
    await axios.delete(`/exhibitions/${exhibitionId.value}/live-photos/${p.id}`)
    ElMessage.success('已删除')
    deleteLivePhotoDialogOpen.value = false
    deleteLivePhotoTarget.value = null
    await fetchDetail(exhibitionId.value)
  } catch (e) {
    console.error('delete live photo failed:', e)
    ElMessage.error(e?.response?.data?.error || '删除失败')
  } finally {
    deletingLivePhoto.value = false
  }
}

function openAddDialog() {
  resetExhibitionForm()
  resetCoverUploadState()
  exhibitionDialogMode.value = 'add'
  exhibitionDialogVisible.value = true
}

async function openEditDialog(row) {
  resetExhibitionForm()
  resetCoverUploadState()
  exhibitionDialogMode.value = 'edit'

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
      end_at: exhibitionForm.end_at ? `${exhibitionForm.end_at}T00:00:00` : null,
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
    if (isDetailMode.value) await fetchDetail(exhibitionId.value)
    else await fetchExhibitions()
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || e.message || '操作失败')
  } finally {
    savingExhibition.value = false
  }
}

function retryFetchExhibitions() {
  listError.value = ''
  fetchExhibitions()
}

async function fetchExhibitions() {
  loadingList.value = true
  listError.value = ''
  try {
    const res = await axios.get('/exhibitions?page=1&pageSize=100')
    const list = res?.data && Array.isArray(res.data) ? res.data : []
    exhibitions.value = list
  } catch (e) {
    exhibitions.value = []
    listError.value = e?.response?.data?.error || e?.message || '获取展览列表失败，请稍后重试'
  } finally {
    loadingList.value = false
  }
}

function retryFetchDetail() {
  detailError.value = ''
  fetchDetail(exhibitionId.value)
}

const artistsOptions = ref([])
const originalArtworkOptions = ref([])
const digitalArtworkOptions = ref([])

const filteredOriginalArtworks = computed(() => {
  const q = originalArtworkFilter.value.trim().toLowerCase()
  const list = originalArtworkOptions.value || []
  if (!q) return list
  return list.filter(
    (a) =>
      String(a.id).includes(q) ||
      (a.title && String(a.title).toLowerCase().includes(q)),
  )
})

const filteredDigitalArtworks = computed(() => {
  const q = digitalArtworkFilter.value.trim().toLowerCase()
  const list = digitalArtworkOptions.value || []
  if (!q) return list
  return list.filter(
    (a) =>
      String(a.id).includes(q) ||
      (a.title && String(a.title).toLowerCase().includes(q)),
  )
})

const filteredArtistsForItems = computed(() => {
  const q = itemsArtistFilter.value.trim().toLowerCase()
  const list = artistsOptions.value || []
  if (!q) return list
  return list.filter((a) => a.name && String(a.name).toLowerCase().includes(q))
})

const filteredArtistsForEdit = computed(() => {
  const q = editArtistFilter.value.trim().toLowerCase()
  const list = artistsOptions.value || []
  if (!q) return list
  return list.filter((a) => a.name && String(a.name).toLowerCase().includes(q))
})

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
    artist_name: a.artist_name,
  }))
}

async function fetchDigitalArtworksOptions() {
  const res = await axios.get('/digital-artworks?page=1&pageSize=1000')
  const list = res?.data && Array.isArray(res.data) ? res.data : []
  digitalArtworkOptions.value = list.map((a) => ({
    id: a.id,
    title: a.title,
    image_url: a.image_url,
    artist_name: a.artist?.name || a.artist_name,
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
  if (artistsOptions.value.length && originalArtworkOptions.value.length && digitalArtworkOptions.value.length) return
  await Promise.all([fetchArtists(), fetchOriginalArtworksOptions(), fetchDigitalArtworksOptions()])
}

async function fetchDetail(id) {
  if (!id) return
  loadingDetail.value = true
  detailError.value = ''
  try {
    const res = await axios.get(`/exhibitions/${id}`)
    exhibitionDetail.value = res
  } catch (e) {
    exhibitionDetail.value = null
    detailError.value = e?.response?.data?.error || e?.message || '获取展览详情失败，请稍后重试'
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
  { immediate: false },
)

onMounted(async () => {
  if (isDetailMode.value) {
    await fetchDetail(exhibitionId.value)
    await ensureOptionsLoaded()
  } else {
    await fetchExhibitions()
  }
})

const itemsDialogVisible = ref(false)

const itemDraft = reactive({
  artwork_type: 'original',
  artwork_id: 0,
  sort_order: 1,
  artists: [],
})

const pendingItems = ref([])

function handleArtworkTypeChange() {
  itemDraft.artwork_id = 0
  const existingLen = exhibitionDetail.value?.items?.length || 0
  const base = existingLen
  itemDraft.sort_order = base + pendingItems.value.length + 1
}

function openItemsDialog() {
  itemsDialogVisible.value = true
  pendingItems.value = []
  itemDraft.artwork_type = 'original'
  itemDraft.artwork_id = 0
  itemDraft.artists = []
  originalArtworkFilter.value = ''
  digitalArtworkFilter.value = ''
  itemsArtistFilter.value = ''
  const existingLen = exhibitionDetail.value?.items?.length || 0
  itemDraft.sort_order = existingLen + 1
}

function addDraftItem() {
  const artworkId = itemDraft.artwork_id
  if (!artworkId) {
    ElMessage.error('请选择 artwork_id')
    return
  }
  const artists = Array.isArray(itemDraft.artists) ? itemDraft.artists.map((id) => Number(id)) : []

  pendingItems.value.push({
    artwork_type: itemDraft.artwork_type,
    artwork_id: artworkId,
    sort_order: itemDraft.sort_order,
    artists,
  })

  const existingLen = exhibitionDetail.value?.items?.length || 0
  itemDraft.sort_order = existingLen + pendingItems.value.length + 1
  itemDraft.artwork_id = 0
  itemDraft.artists = []
}

function removePendingItem(index) {
  pendingItems.value.splice(index, 1)
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

const editArtistsDialogVisible = ref(false)
const editArtistsItemId = ref(null)
const editArtistsDraftArtistIds = ref([])

function openEditArtistsDialog(row) {
  editArtistsItemId.value = row.id
  editArtistsDraftArtistIds.value = (row.artists || []).map((a) => a.id)
  editArtistFilter.value = ''
  editArtistsDialogVisible.value = true
}

function openRemoveItemDialog(row) {
  if (!exhibitionId.value || !row?.id) return
  removeItemTarget.value = row
  removeItemDialogOpen.value = true
}

async function confirmRemoveItem() {
  if (!exhibitionId.value || !removeItemTarget.value?.id) return
  removingItem.value = true
  try {
    await axios.delete(`/exhibitions/${exhibitionId.value}/items/${removeItemTarget.value.id}`)
    ElMessage.success('移除成功')
    removeItemDialogOpen.value = false
    removeItemTarget.value = null
    await fetchDetail(exhibitionId.value)
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '移除失败')
  } finally {
    removingItem.value = false
  }
}

async function submitArtists() {
  if (!exhibitionId.value || !editArtistsItemId.value) return
  savingArtists.value = true
  try {
    const artist_ids = (editArtistsDraftArtistIds.value || []).map((id) => Number(id))
    await axios.put(
      `/exhibitions/${exhibitionId.value}/items/${editArtistsItemId.value}/artists`,
      { artist_ids },
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
