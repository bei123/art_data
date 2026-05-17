<template>
  <div class="flex flex-col gap-6 p-4 md:p-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-semibold tracking-tight text-foreground">
        艺术家管理
      </h2>
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          :model-value="institutionSelectValue"
          @update:model-value="onInstitutionSelectChange"
        >
          <SelectTrigger class="h-9 w-full min-w-[200px] sm:w-[240px]">
            <SelectValue placeholder="按机构筛选" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部艺术家</SelectItem>
            <SelectItem
              v-for="institution in institutions"
              :key="institution.id"
              :value="String(institution.id)"
            >
              {{ institution.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <template v-if="selectedArtistCount > 0">
          <span class="self-center text-sm text-muted-foreground tabular-nums">
            已选 {{ selectedArtistCount }} 项
          </span>
          <Button type="button" variant="outline" size="sm" @click="clearArtistSelection">
            取消选择
          </Button>
          <Button type="button" variant="destructive" size="sm" @click="openBulkDeleteArtistDialog">
            批量删除
          </Button>
        </template>
        <Button type="button" @click="handleAdd">
          添加艺术家
        </Button>
      </div>
    </div>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchArtists">
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <Card class="relative overflow-hidden shadow-none ring-1">
      <div
        v-if="listLoading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <table class="w-full min-w-[800px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-10 px-2 text-left font-medium">
                <Checkbox
                  :checked="allFilteredArtistsSelected ? true : someFilteredArtistsSelected ? 'indeterminate' : false"
                  aria-label="全选当前页"
                  @update:checked="toggleSelectAllFilteredArtists"
                />
              </th>
              <th class="h-10 w-16 px-3 text-left font-medium">头像</th>
              <th class="h-10 px-3 text-left font-medium">姓名</th>
              <th class="h-10 px-3 text-left font-medium">时代</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">所属机构</th>
              <th class="h-10 min-w-[10rem] px-3 text-left font-medium">公开</th>
              <th class="h-10 max-w-[14rem] px-3 text-left font-medium">艺术历程</th>
              <th class="h-10 w-44 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredArtists"
              :key="row.id"
              class="border-b border-border transition-colors hover:bg-muted/30"
              :class="{ 'bg-muted/50': isArtistSelected(row.id) }"
            >
              <td class="px-2 py-2">
                <Checkbox
                  :checked="isArtistSelected(row.id)"
                  :aria-label="`选择 ${row.name || '艺术家'}`"
                  @update:checked="(v) => toggleArtistSelect(row.id, v)"
                />
              </td>
              <td class="px-3 py-2">
                <div class="size-12 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getImageUrl(row.avatar)"
                    :alt="row.name ? `${row.name} 头像` : '艺术家头像'"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="(e) => { e.target.style.opacity = '0.35' }"
                  >
                </div>
              </td>
              <td class="px-3 py-2.5 font-medium">{{ row.name }}</td>
              <td class="px-3 py-2.5 text-muted-foreground">{{ row.era }}</td>
              <td class="px-3 py-2.5">
                <Badge v-if="row.institution" variant="secondary">
                  {{ row.institution.name }}
                </Badge>
                <span v-else class="text-muted-foreground">独立艺术家</span>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    type="button"
                    :variant="Number(row.is_public) !== 0 ? 'default' : 'outline'"
                    class="h-8"
                    :disabled="artistIsPublicUpdatingId === row.id"
                    @click="handleArtistListPublicChange(row, 1)"
                  >
                    公开
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    :variant="Number(row.is_public) === 0 ? 'default' : 'outline'"
                    class="h-8"
                    :disabled="artistIsPublicUpdatingId === row.id"
                    @click="handleArtistListPublicChange(row, 0)"
                  >
                    仅后台
                  </Button>
                  <Loader2
                    v-if="artistIsPublicUpdatingId === row.id"
                    class="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </td>
              <td class="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground" :title="row.description">
                {{ row.description }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" type="button" @click="handleEdit(row)">
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" type="button" @click="openDeleteArtistDialog(row)">
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="filteredArtists.length === 0 && !listLoading">
              <td colspan="8" class="px-3 py-12 text-center text-muted-foreground">
                暂无艺术家数据
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span class="text-sm text-muted-foreground">共 {{ pagination.total }} 条</span>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted-foreground">每页</span>
          <Select
            :model-value="String(pagination.pageSize)"
            @update:model-value="(v) => handleArtistPageSizeChange(Number(v))"
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
            :disabled="pagination.page <= 1 || listLoading"
            @click="handleArtistPageChange(pagination.page - 1)"
          >
            上一页
          </Button>
          <span class="min-w-[5rem] text-center text-sm tabular-nums">
            {{ pagination.page }} / {{ artistTotalPages }}
          </span>
          <Button
            size="sm"
            variant="outline"
            :disabled="pagination.page >= artistTotalPages || listLoading"
            @click="handleArtistPageChange(pagination.page + 1)"
          >
            下一页
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogVisible">
      <DialogContent class="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ isEdit ? '编辑艺术家' : '添加艺术家' }}</DialogTitle>
        </DialogHeader>

        <div class="grid gap-4 py-2">
          <div class="flex flex-col gap-2">
            <Label for="artist-name">艺术家姓名</Label>
            <Input id="artist-name" v-model="form.name" autocomplete="name" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="artist-era">所属时代</Label>
            <Input id="artist-era" v-model="form.era" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="artist-inst">所属机构</Label>
            <select
              id="artist-inst"
              class="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              :value="form.institution_id == null ? '' : String(form.institution_id)"
              @change="onFormInstitutionChange"
            >
              <option value="">独立艺术家</option>
              <option
                v-for="institution in institutions"
                :key="institution.id"
                :value="String(institution.id)"
              >
                {{ institution.name }}
              </option>
            </select>
          </div>

          <div class="flex flex-col gap-2">
            <Label>头像 <span class="text-destructive">*</span></Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="form.avatar"
                class="group relative size-[200px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img
                  :src="getImageUrl(form.avatar)"
                  alt="头像"
                  class="size-full object-cover"
                >
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="openRemoveAvatarDialog">
                    <Trash2 class="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" @click="triggerAvatarInput">
                    更换头像
                  </Button>
                </div>
              </div>
              <div
                v-else
                class="relative flex size-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
                :class="{
                  'border-primary/50 bg-primary/5': isAvatarDragOver,
                  'pointer-events-none opacity-70': isAvatarUploading || isAvatarProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerAvatarInput"
                @keydown.enter.prevent="triggerAvatarInput"
                @keydown.space.prevent="triggerAvatarInput"
                @dragenter="handleAvatarDragEnter"
                @dragleave="handleAvatarDragLeave"
                @dragover="handleAvatarDragOver"
                @drop="handleAvatarDrop"
              >
                <Loader2
                  v-if="isAvatarUploading || isAvatarProcessing"
                  class="mb-2 size-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <Upload v-else class="mb-2 size-10 text-muted-foreground" aria-hidden="true" />
                <p class="px-2 text-center text-sm font-medium text-foreground">
                  {{ isAvatarProcessing ? '正在处理图片…' : isAvatarUploading ? '正在上传…' : '点击或拖拽图片到此处上传' }}
                </p>
                <p class="mt-1 px-2 text-center text-xs text-muted-foreground">
                  支持 JPG、PNG、GIF，自动转 WebP 并压缩至 5MB 以内
                </p>
                <div
                  v-if="isAvatarDragOver && !form.avatar"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-10" aria-hidden="true" />
                  <span>释放鼠标上传图片</span>
                </div>
              </div>
              <input
                ref="avatarInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleAvatarFileSelect"
              >
              <div v-if="isAvatarProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div class="mb-2 flex justify-between text-muted-foreground">
                  <span>图片处理中</span>
                  <span>处理中…</span>
                </div>
                <Progress :model-value="40" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ avatarFileName }}</span>
                  <span>{{ formatFileSize(avatarFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将图片转换为 WebP 并压缩…
                </p>
              </div>
              <div
                v-if="avatarUploadProgress > 0 && avatarUploadProgress < 100 && !isAvatarProcessing"
                class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
                <div class="mb-2 flex justify-between">
                  <span class="font-medium">上传进度</span>
                  <span class="font-semibold text-primary tabular-nums">{{ avatarUploadProgress }}%</span>
                </div>
                <Progress :model-value="avatarUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ avatarFileName }}</span>
                  <span>{{ formatFileSize(avatarFileSize) }}</span>
                </div>
              </div>
              <Alert v-if="avatarUploadProgress === 100" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>头像上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>背景图 <span class="text-destructive">*</span></Label>
            <div class="max-w-[400px] space-y-3">
              <div
                v-if="form.banner"
                class="group relative size-[200px] overflow-hidden rounded-lg border border-border shadow-sm"
              >
                <img
                  :src="getImageUrl(form.banner)"
                  alt="背景图"
                  class="size-full object-cover"
                >
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Button type="button" size="icon" variant="destructive" @click="openRemoveBannerDialog">
                    <Trash2 class="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" @click="triggerBannerInput">
                    更换背景图
                  </Button>
                </div>
              </div>
              <div
                v-else
                class="relative flex size-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/40"
                :class="{
                  'border-primary/50 bg-primary/5': isBannerDragOver,
                  'pointer-events-none opacity-70': isBannerUploading || isBannerProcessing,
                }"
                role="button"
                tabindex="0"
                @click="triggerBannerInput"
                @keydown.enter.prevent="triggerBannerInput"
                @keydown.space.prevent="triggerBannerInput"
                @dragenter="handleBannerDragEnter"
                @dragleave="handleBannerDragLeave"
                @dragover="handleBannerDragOver"
                @drop="handleBannerDrop"
              >
                <Loader2
                  v-if="isBannerUploading || isBannerProcessing"
                  class="mb-2 size-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <Upload v-else class="mb-2 size-10 text-muted-foreground" aria-hidden="true" />
                <p class="px-2 text-center text-sm font-medium text-foreground">
                  {{ isBannerProcessing ? '正在处理图片…' : isBannerUploading ? '正在上传…' : '点击或拖拽图片到此处上传' }}
                </p>
                <p class="mt-1 px-2 text-center text-xs text-muted-foreground">
                  支持 JPG、PNG、GIF，自动转 WebP 并压缩至 5MB 以内
                </p>
                <div
                  v-if="isBannerDragOver && !form.banner"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary"
                >
                  <Upload class="mb-2 size-10" aria-hidden="true" />
                  <span>释放鼠标上传图片</span>
                </div>
              </div>
              <input
                ref="bannerInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleBannerFileSelect"
              >
              <div v-if="isBannerProcessing" class="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div class="mb-2 flex justify-between text-muted-foreground">
                  <span>图片处理中</span>
                  <span>处理中…</span>
                </div>
                <Progress :model-value="40" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ bannerFileName }}</span>
                  <span>{{ formatFileSize(bannerFileSize) }}</span>
                </div>
                <p class="mt-2 text-center text-xs italic text-muted-foreground">
                  正在将图片转换为 WebP 并压缩…
                </p>
              </div>
              <div
                v-if="bannerUploadProgress > 0 && bannerUploadProgress < 100 && !isBannerProcessing"
                class="rounded-lg border border-border bg-muted/40 p-3 text-sm"
              >
                <div class="mb-2 flex justify-between">
                  <span class="font-medium">上传进度</span>
                  <span class="font-semibold text-primary tabular-nums">{{ bannerUploadProgress }}%</span>
                </div>
                <Progress :model-value="bannerUploadProgress" class="h-2" />
                <div class="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span class="max-w-[150px] truncate">{{ bannerFileName }}</span>
                  <span>{{ formatFileSize(bannerFileSize) }}</span>
                </div>
              </div>
              <Alert v-if="bannerUploadProgress === 100" class="border-primary/30">
                <AlertCircle class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <AlertTitle>背景图上传成功</AlertTitle>
              </Alert>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <Label>公开接口展示</Label>
            <p class="text-xs text-muted-foreground">
              关闭后未登录访客无法在列表、详情与搜索中看到该艺术家；管理员登录后台后仍可管理。
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

            <Label for="artist-desc">简介</Label>
            <Textarea id="artist-desc" v-model="form.description" class="min-h-24" rows="4" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="artist-journey">艺术历程</Label>
            <Textarea
              id="artist-journey"
              v-model="form.journey"
              class="min-h-32"
              rows="6"
              placeholder="请按时间顺序记录艺术家的重要创作时期、重大作品、获奖经历等"
            />
          </div>

          <div class="flex items-center gap-4 py-1">
            <Separator class="flex-1" />
            <span class="shrink-0 text-sm text-muted-foreground">代表作品</span>
            <Separator class="flex-1" />
          </div>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card class="shadow-none ring-1">
              <CardHeader class="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle class="text-sm font-medium">
                  该艺术家全部作品（{{ filteredFeaturedAllArtworks.length }}）
                </CardTitle>
                <Input
                  v-model="featuredSearch"
                  class="h-8 max-w-full sm:max-w-[220px]"
                  placeholder="搜索标题/ID/年份"
                />
              </CardHeader>
              <CardContent class="p-0">
                <div class="max-h-[260px] overflow-y-auto p-3">
                  <p
                    v-if="filteredFeaturedAllArtworks.length === 0"
                    class="py-8 text-center text-sm text-muted-foreground"
                  >
                    暂无作品或未匹配
                  </p>
                  <ul v-else class="divide-y divide-border">
                    <li
                      v-for="item in filteredFeaturedAllArtworks"
                      :key="item.id"
                      class="flex items-center justify-between gap-2 py-2.5 text-sm"
                    >
                      <span class="min-w-0 flex-1 truncate font-medium" :title="item.title">{{ item.title }}</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        :disabled="featuredSelected.some((i) => i.id === item.id)"
                        @click="featuredAdd(item)"
                      >
                        {{ featuredSelected.some((i) => i.id === item.id) ? '已添加' : '添加' }}
                      </Button>
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card class="shadow-none ring-1">
              <CardHeader class="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle class="text-sm font-medium">
                  已选代表作品（可排序，{{ featuredSelected.length }}）
                </CardTitle>
                <div class="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    :disabled="featuredSelected.length === 0"
                    @click="featuredClear"
                  >
                    清空
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    :disabled="!isEdit || featuredSaving"
                    @click="featuredSave"
                  >
                    <Loader2
                      v-if="featuredSaving"
                      class="mr-1.5 inline size-3.5 animate-spin align-middle"
                      aria-hidden="true"
                    />
                    {{ featuredSaving ? '保存中…' : '保存' }}
                  </Button>
                </div>
              </CardHeader>
              <CardContent class="p-0">
                <div class="max-h-[260px] overflow-y-auto p-3">
                  <p v-if="featuredSelected.length === 0" class="py-8 text-center text-sm text-muted-foreground">
                    未选择
                  </p>
                  <ul v-else class="divide-y divide-border">
                    <li
                      v-for="(item, index) in featuredSelected"
                      :key="item.id"
                      class="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span class="min-w-0 flex-1 truncate font-medium" :title="item.title">{{ item.title }}</span>
                      <div class="flex shrink-0 flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          :disabled="index === 0"
                          @click="featuredMoveUp(index)"
                        >
                          上移
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          :disabled="index === featuredSelected.length - 1"
                          @click="featuredMoveDown(index)"
                        >
                          下移
                        </Button>
                        <Button size="sm" variant="destructive" type="button" @click="featuredRemove(index)">
                          移除
                        </Button>
                      </div>
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" @click="handleSubmit">
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="bulkDeleteArtistDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>批量删除艺术家</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除已选的 {{ selectedArtistCount }} 位艺术家吗？其名下原作将一并删除，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="bulkDeletingArtists"
            @click="confirmBulkDeleteArtists"
          >
            <Loader2 v-if="bulkDeletingArtists" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteArtistDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除艺术家</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{{ deleteArtistName }}」吗？其名下原作将一并删除，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            :disabled="deletingArtist"
            @click="confirmDeleteArtist"
          >
            <Loader2 v-if="deletingArtist" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="removeAvatarDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除头像</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这张头像吗？保存前仍可重新上传。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button type="button" variant="destructive" @click="confirmRemoveAvatar">
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="removeBannerDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除背景图</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这张背景图吗？保存前仍可重新上传。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter class="gap-2 sm:justify-end">
          <AlertDialogCancel type="button">
            取消
          </AlertDialogCancel>
          <Button type="button" variant="destructive" @click="confirmRemoveBanner">
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { AlertCircle, Loader2, Trash2, Upload } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

const listLoading = ref(false)
const listError = ref('')
const institutions = ref([])
const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
})
const dialogVisible = ref(false)
const isEdit = ref(false)
const selectedInstitutionId = ref(null)
const filteredArtists = ref([])
const featuredAllArtworks = ref([])
const featuredSelected = ref([])
const featuredSearch = ref('')
const featuredSaving = ref(false)

const artistIsPublicUpdatingId = ref(null)

const selectedArtistIds = ref([])
const bulkDeleteArtistDialogOpen = ref(false)
const bulkDeletingArtists = ref(false)

const selectedArtistCount = computed(() => selectedArtistIds.value.length)

const allFilteredArtistsSelected = computed(() => {
  const rows = filteredArtists.value
  if (!rows.length) return false
  return rows.every((r) => selectedArtistIds.value.includes(r.id))
})

const someFilteredArtistsSelected = computed(() => {
  const idSet = new Set(filteredArtists.value.map((r) => r.id))
  return selectedArtistIds.value.some((id) => idSet.has(id))
})

function isArtistSelected(id) {
  return selectedArtistIds.value.includes(id)
}

function toggleArtistSelect(id, checked) {
  if (checked === true || checked === 'indeterminate') {
    if (!selectedArtistIds.value.includes(id)) {
      selectedArtistIds.value = [...selectedArtistIds.value, id]
    }
  } else {
    selectedArtistIds.value = selectedArtistIds.value.filter((x) => x !== id)
  }
}

function toggleSelectAllFilteredArtists(checked) {
  const pageIds = filteredArtists.value.map((r) => r.id)
  if (checked === true || checked === 'indeterminate') {
    selectedArtistIds.value = [...new Set([...selectedArtistIds.value, ...pageIds])]
  } else {
    const pageSet = new Set(pageIds)
    selectedArtistIds.value = selectedArtistIds.value.filter((id) => !pageSet.has(id))
  }
}

function clearArtistSelection() {
  selectedArtistIds.value = []
}

function openBulkDeleteArtistDialog() {
  if (selectedArtistCount.value === 0) return
  bulkDeleteArtistDialogOpen.value = true
}

async function confirmBulkDeleteArtists() {
  if (selectedArtistCount.value === 0) return
  bulkDeletingArtists.value = true
  try {
    const ids = [...selectedArtistIds.value]
    await axios.post('/artists/bulk-delete', { ids })
    ElMessage.success(`已删除 ${ids.length} 位艺术家`)
    bulkDeleteArtistDialogOpen.value = false
    clearArtistSelection()
    pagination.value.page = 1
    await fetchArtists()
  } catch (e) {
    const msg = e?.response?.data?.error || '批量删除失败'
    ElMessage.error(typeof msg === 'string' ? msg : '批量删除失败')
  } finally {
    bulkDeletingArtists.value = false
  }
}

const institutionSelectValue = computed(() =>
  selectedInstitutionId.value == null ? 'all' : String(selectedInstitutionId.value)
)

const artistTotalPages = computed(() =>
  Math.max(1, Math.ceil((pagination.value.total || 0) / (pagination.value.pageSize || 20)))
)

function onInstitutionSelectChange(v) {
  selectedInstitutionId.value = v === 'all' ? null : Number(v)
  pagination.value.page = 1
  clearArtistSelection()
  fetchArtists()
}

function handleArtistPageSizeChange(newSize) {
  pagination.value.pageSize = newSize
  pagination.value.page = 1
  clearArtistSelection()
  fetchArtists()
}

function handleArtistPageChange(newPage) {
  pagination.value.page = newPage
  clearArtistSelection()
  fetchArtists()
}

function onFormInstitutionChange(e) {
  const v = e.target.value
  form.value.institution_id = v === '' ? null : Number(v)
}

// 头像上传相关状态
const avatarInput = ref(null)
const isAvatarDragOver = ref(false)
const avatarUploadProgress = ref(0)
const isAvatarUploading = ref(false)
const isAvatarProcessing = ref(false)
const avatarFileName = ref('')
const avatarFileSize = ref(0)

// 背景图上传相关状态
const bannerInput = ref(null)
const isBannerDragOver = ref(false)
const bannerUploadProgress = ref(0)
const isBannerUploading = ref(false)
const isBannerProcessing = ref(false)
const bannerFileName = ref('')
const bannerFileSize = ref(0)

const form = ref({
  name: '',
  era: '',
  avatar: '',
  banner: '',
  description: '',
  journey: '',
  institution_id: null,
  is_public: 1
})

const deleteArtistDialogOpen = ref(false)
const deleteArtistTarget = ref(null)
const deletingArtist = ref(false)
const deleteArtistName = computed(() => {
  const row = deleteArtistTarget.value
  if (!row) return '该艺术家'
  return row.name || '未命名'
})

const removeAvatarDialogOpen = ref(false)
const removeBannerDialogOpen = ref(false)

const retryFetchArtists = () => {
  listError.value = ''
  fetchArtists()
}

const fetchArtists = async () => {
  listLoading.value = true
  listError.value = ''
  try {
    const params = {
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    }
    if (selectedInstitutionId.value != null) {
      params.institution_id = selectedInstitutionId.value
    }
    const response = await axios.get('/artists', { params })

    let data = response.data ?? response
    let paginationInfo = response.pagination

    if (response.data && response.pagination) {
      data = response.data
      paginationInfo = response.pagination
    } else if (Array.isArray(response)) {
      data = response
      paginationInfo = {
        page: pagination.value.page,
        pageSize: pagination.value.pageSize,
        total: response.length,
      }
    } else if (response.artists && Array.isArray(response.artists)) {
      data = response.artists
      paginationInfo = {
        page: 1,
        pageSize: response.artists.length,
        total: response.total ?? response.artists.length,
      }
    } else if (!Array.isArray(data)) {
      throw new Error('无效的响应数据')
    }

    filteredArtists.value = Array.isArray(data) ? data : []

    if (paginationInfo) {
      pagination.value.total = paginationInfo.total ?? 0
      pagination.value.page = paginationInfo.page ?? pagination.value.page
      pagination.value.pageSize = paginationInfo.pageSize ?? pagination.value.pageSize
    }
  } catch (error) {
    console.error('获取艺术家列表失败：', error)
    filteredArtists.value = []
    pagination.value.total = 0
    listError.value = '获取艺术家列表失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

function syncArtistIsPublicInLists(artistId, isPublic) {
  const v = Number(isPublic) === 0 ? 0 : 1
  const i = filteredArtists.value.findIndex((a) => a.id === artistId)
  if (i >= 0) filteredArtists.value[i] = { ...filteredArtists.value[i], is_public: v }
}

const handleArtistListPublicChange = async (row, nextPublic) => {
  const next = Number(nextPublic) === 0 ? 0 : 1
  if (Number(row.is_public) === next) return
  artistIsPublicUpdatingId.value = row.id
  try {
    await axios.put(`/artists/${row.id}`, { is_public: next })
    syncArtistIsPublicInLists(row.id, next)
    ElMessage.success(next === 1 ? '已设为公开' : '已设为仅后台')
  } catch (e) {
    const msg = e?.response?.data?.error || '更新失败'
    ElMessage.error(typeof msg === 'string' ? msg : '更新失败')
  } finally {
    artistIsPublicUpdatingId.value = null
  }
}

const fetchInstitutions = async () => {
  try {
    const data = await axios.get('/institutions')
    if (Array.isArray(data)) {
      institutions.value = data
    } else {
      institutions.value = []
    }
  } catch (error) {
    console.error('获取机构列表失败：', error)
    institutions.value = []
  }
}

const handleAdd = () => {
  isEdit.value = false
  form.value = {
    name: '',
    era: '',
    avatar: '',
    banner: '',
    description: '',
    journey: '',
    institution_id: null,
    is_public: 1
  }
  featuredSearch.value = ''
  featuredAllArtworks.value = []
  featuredSelected.value = []
  resetAvatarUploadState()
  resetBannerUploadState()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  form.value = {
    id: row.id,
    name: row.name,
    era: row.era,
    avatar: row.avatar,
    banner: row.banner,
    description: row.description,
    journey: row.journey,
    institution_id: row.institution ? row.institution.id : null,
    is_public: Number(row.is_public) === 0 ? 0 : 1
  }
  featuredSearch.value = ''
  featuredAllArtworks.value = []
  resetAvatarUploadState()
  resetBannerUploadState()
  dialogVisible.value = true
  fetchFeaturedAll(row.id)
  fetchFeaturedSelected(row.id)
}

function openDeleteArtistDialog(row) {
  deleteArtistTarget.value = row
  deleteArtistDialogOpen.value = true
}

async function confirmDeleteArtist() {
  const row = deleteArtistTarget.value
  if (!row?.id) return
  deletingArtist.value = true
  try {
    await axios.delete(`/artists/${row.id}`)
    ElMessage.success('删除成功')
    deleteArtistDialogOpen.value = false
    deleteArtistTarget.value = null
    await fetchArtists()
  } catch {
    ElMessage.error('删除失败')
  } finally {
    deletingArtist.value = false
  }
}

function openRemoveAvatarDialog() {
  removeAvatarDialogOpen.value = true
}

function confirmRemoveAvatar() {
  form.value.avatar = ''
  ElMessage.success('头像已删除')
  removeAvatarDialogOpen.value = false
}

// 头像上传相关函数
const triggerAvatarInput = () => {
  if (!isAvatarUploading.value && !isAvatarProcessing.value) {
    avatarInput.value?.click()
  }
}

const handleAvatarFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadAvatarFile(file)
  }
  event.target.value = ''
}

const uploadAvatarFile = async (file) => {
  avatarUploadProgress.value = 0
  isAvatarUploading.value = true
  isAvatarProcessing.value = true
  avatarFileName.value = file.name
  avatarFileSize.value = file.size

  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)

    if (!processedFile) {
      resetAvatarUploadState()
      return
    }

    isAvatarProcessing.value = false
    avatarFileName.value = processedFile.name
    avatarFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          avatarUploadProgress.value = percent
        } else {
          avatarUploadProgress.value = Math.min(avatarUploadProgress.value + 10, 90)
        }
      }
    })

    handleAvatarUploadSuccess(response)
  } catch (error) {
    handleAvatarUploadError(error)
  }
}

const handleAvatarUploadSuccess = (response) => {
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
    form.value.avatar = imageUrl
    avatarUploadProgress.value = 100

    setTimeout(() => {
      avatarUploadProgress.value = 0
      isAvatarUploading.value = false
      avatarFileName.value = ''
      avatarFileSize.value = 0
    }, 2000)

    ElMessage.success('头像上传成功')
  } else {
    ElMessage.error('头像上传失败：未获取到图片URL')
    resetAvatarUploadState()
  }
}

const handleAvatarUploadError = (error) => {
  console.error('头像上传错误:', error)
  ElMessage.error('头像上传失败：' + (error.response?.data?.message || '未知错误'))
  resetAvatarUploadState()
}

const resetAvatarUploadState = () => {
  avatarUploadProgress.value = 0
  isAvatarUploading.value = false
  isAvatarProcessing.value = false
  avatarFileName.value = ''
  avatarFileSize.value = 0
}

// 背景图上传相关函数
const triggerBannerInput = () => {
  if (!isBannerUploading.value && !isBannerProcessing.value) {
    bannerInput.value?.click()
  }
}

const handleBannerFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadBannerFile(file)
  }
  event.target.value = ''
}

const uploadBannerFile = async (file) => {
  bannerUploadProgress.value = 0
  isBannerUploading.value = true
  isBannerProcessing.value = true
  bannerFileName.value = file.name
  bannerFileSize.value = file.size

  try {
    const processedFile = await uploadImageToWebpLimit5MB(file)

    if (!processedFile) {
      resetBannerUploadState()
      return
    }

    isBannerProcessing.value = false
    bannerFileName.value = processedFile.name
    bannerFileSize.value = processedFile.size

    const formData = new FormData()
    formData.append('file', processedFile)

    const response = await axios.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          bannerUploadProgress.value = percent
        } else {
          bannerUploadProgress.value = Math.min(bannerUploadProgress.value + 10, 90)
        }
      }
    })

    handleBannerUploadSuccess(response)
  } catch (error) {
    handleBannerUploadError(error)
  }
}

const handleBannerUploadSuccess = (response) => {
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
    form.value.banner = imageUrl
    bannerUploadProgress.value = 100

    setTimeout(() => {
      bannerUploadProgress.value = 0
      isBannerUploading.value = false
      bannerFileName.value = ''
      bannerFileSize.value = 0
    }, 2000)

    ElMessage.success('背景图上传成功')
  } else {
    ElMessage.error('背景图上传失败：未获取到图片URL')
    resetBannerUploadState()
  }
}

const handleBannerUploadError = (error) => {
  console.error('背景图上传错误:', error)
  ElMessage.error('背景图上传失败：' + (error.response?.data?.message || '未知错误'))
  resetBannerUploadState()
}

const resetBannerUploadState = () => {
  bannerUploadProgress.value = 0
  isBannerUploading.value = false
  isBannerProcessing.value = false
  bannerFileName.value = ''
  bannerFileSize.value = 0
}

function openRemoveBannerDialog() {
  removeBannerDialogOpen.value = true
}

function confirmRemoveBanner() {
  form.value.banner = ''
  ElMessage.success('背景图已删除')
  removeBannerDialogOpen.value = false
}

// 拖拽处理函数
const handleAvatarDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isAvatarUploading.value && !isAvatarProcessing.value && !form.value.avatar) {
    isAvatarDragOver.value = true
  }
}

const handleAvatarDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isAvatarDragOver.value = false
  }
}

const handleAvatarDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleAvatarDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isAvatarDragOver.value = false

  if (isAvatarUploading.value || isAvatarProcessing.value || form.value.avatar) return

  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadAvatarFile(files[0])
  }
}

const handleBannerDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isBannerUploading.value && !isBannerProcessing.value && !form.value.banner) {
    isBannerDragOver.value = true
  }
}

const handleBannerDragLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!e.currentTarget.contains(e.relatedTarget)) {
    isBannerDragOver.value = false
  }
}

const handleBannerDragOver = (e) => {
  e.preventDefault()
  e.stopPropagation()
}

const handleBannerDrop = (e) => {
  e.preventDefault()
  e.stopPropagation()
  isBannerDragOver.value = false

  if (isBannerUploading.value || isBannerProcessing.value || form.value.banner) return

  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadBannerFile(files[0])
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
  if (!url) return ''
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`
}

// 代表作品：拉取全部作品
const fetchFeaturedAll = async (artistId) => {
  try {
    const resp = await axios.get(`/original-artworks`, { params: { artist_id: artistId, pageSize: 1000 } })
    const list = Array.isArray(resp)
      ? resp
      : (Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp?.data?.data) ? resp.data.data : []))
    featuredAllArtworks.value = list
  } catch {
    featuredAllArtworks.value = []
  }
}
// 代表作品：拉取已选
const fetchFeaturedSelected = async (artistId) => {
  try {
    const resp = await axios.get(`/artists/${artistId}/featured-artworks`)
    const list = Array.isArray(resp)
      ? resp
      : (Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp?.data?.data) ? resp.data.data : []))
    featuredSelected.value = list
  } catch {
    featuredSelected.value = []
  }
}

const filteredFeaturedAllArtworks = computed(() => {
  const raw = (featuredSearch.value || '').toString().trim().toLowerCase()
  if (!raw) return featuredAllArtworks.value
  return featuredAllArtworks.value.filter(a => {
    const title = (a.title || '').toString().toLowerCase()
    const idStr = (a.id != null ? String(a.id) : '')
    const yearStr = (a.year != null ? String(a.year) : '')
    return title.includes(raw) || idStr.includes(raw) || yearStr.includes(raw)
  })
})

const featuredAdd = (item) => {
  if (!featuredSelected.value.some(i => i.id === item.id)) featuredSelected.value.push(item)
}
const featuredRemove = (index) => {
  featuredSelected.value.splice(index, 1)
}
const featuredMoveUp = (index) => {
  if (index <= 0) return
  const tmp = featuredSelected.value[index - 1]
  featuredSelected.value[index - 1] = featuredSelected.value[index]
  featuredSelected.value[index] = tmp
}
const featuredMoveDown = (index) => {
  if (index >= featuredSelected.value.length - 1) return
  const tmp = featuredSelected.value[index + 1]
  featuredSelected.value[index + 1] = featuredSelected.value[index]
  featuredSelected.value[index] = tmp
}
const featuredClear = () => {
  featuredSelected.value = []
}
const featuredSave = async () => {
  try {
    featuredSaving.value = true
    const ids = featuredSelected.value.map(i => i.id)
    await axios.put(`/artists/${form.value.id}`, {})
    await axios.put(`/artists/${form.value.id}/featured-artworks`, { artwork_ids: ids })
    ElMessage.success('已保存代表作品')
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || '保存代表作品失败')
  } finally {
    featuredSaving.value = false
  }
}

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入艺术家姓名')
    return
  }

  try {
    const submitData = {
      ...form.value,
      avatar: form.value.avatar ? (form.value.avatar.startsWith('http') ? form.value.avatar.replace(API_BASE_URL, '') : form.value.avatar) : '',
      banner: form.value.banner ? (form.value.banner.startsWith('http') ? form.value.banner.replace(API_BASE_URL, '') : form.value.banner) : ''
    }

    if (isEdit.value) {
      await axios.put(`/artists/${form.value.id}`, submitData)
    } else {
      await axios.post('/artists', submitData)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    await fetchArtists()
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

onMounted(() => {
  pagination.value = { page: 1, pageSize: 20, total: 0 }
  fetchInstitutions()
  fetchArtists()
})
</script>
