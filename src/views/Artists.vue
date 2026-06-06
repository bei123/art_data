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
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="selectedArtistCount === 0"
          @click="clearArtistSelection"
        >
          取消选择
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          :disabled="selectedArtistCount === 0"
          @click="openBulkDeleteArtistDialog"
        >
          批量删除
          <span v-if="selectedArtistCount > 0" class="ml-1 tabular-nums">({{ selectedArtistCount }})</span>
        </Button>
        <Button
          v-if="!isSearchMode"
          type="button"
          :variant="isArtistSortMode ? 'default' : 'outline'"
          @click="toggleArtistSortMode"
        >
          {{ isArtistSortMode ? '返回列表' : '调整展示顺序' }}
        </Button>
        <Button type="button" @click="handleAdd">
          添加艺术家
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
              placeholder="搜索姓名、简介、时代、历程或机构名称"
              @keyup.enter="handleArtistSearch"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <Button type="button" :disabled="listLoading" @click="handleArtistSearch">
              搜索
            </Button>
            <Button
              v-if="searchKeyword || isSearchMode"
              type="button"
              variant="outline"
              @click="handleClearArtistSearch"
            >
              清除搜索
            </Button>
          </div>
        </div>
        <Alert v-if="isSearchMode && searchKeyword.trim() && !listLoading">
          <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
          <AlertTitle>搜索结果</AlertTitle>
          <AlertDescription>
            搜索「{{ searchKeyword.trim() }}」共找到 {{ pagination.total }} 条记录
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <Alert v-if="listError && !listLoading" variant="destructive">
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>{{ listError }}</AlertTitle>
      <AlertDescription class="mt-2">
        <Button type="button" variant="secondary" size="sm" @click="retryFetchArtists">
          重试
        </Button>
      </AlertDescription>
    </Alert>

    <Card v-if="isArtistSortMode" class="relative overflow-hidden shadow-none ring-1">
      <CardHeader class="pb-2">
        <CardTitle class="text-base">
          公开艺术家展示顺序
        </CardTitle>
        <p class="text-sm text-muted-foreground">
          {{ artistSortScopeLabel }}。拖拽或使用上下移动调整前台展示顺序，仅对「公开」艺术家生效。
        </p>
      </CardHeader>
      <div
        v-if="sortListLoading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
      <CardContent class="overflow-x-auto p-0 sm:px-6 sm:pb-6">
        <table class="w-full min-w-[640px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-14 px-3 text-left font-medium" />
              <th class="h-10 w-16 px-3 text-left font-medium">序号</th>
              <th class="h-10 w-16 px-3 text-left font-medium">头像</th>
              <th class="h-10 px-3 text-left font-medium">姓名</th>
              <th class="h-10 min-w-[8rem] px-3 text-left font-medium">所属机构</th>
              <th class="h-10 w-36 px-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, sortIndex) in publicArtistsForSort"
              :key="row.id"
              draggable="true"
              class="border-b border-border transition-colors hover:bg-muted/30"
              :class="{
                'opacity-50 ring-2 ring-primary': artistSortDragFromIndex === sortIndex,
                'ring-2 ring-primary/60': artistSortDragOverIndex === sortIndex && artistSortDragFromIndex !== sortIndex,
                'pointer-events-none opacity-60': isSavingArtistsOrder,
              }"
              @dragstart="handleArtistSortDragStart(sortIndex, $event)"
              @dragend="handleArtistSortDragEnd"
              @dragover="handleArtistSortDragOver(sortIndex, $event)"
              @dragleave="handleArtistSortDragLeave(sortIndex, $event)"
              @drop="handleArtistSortDrop(sortIndex, $event)"
            >
              <td class="px-3 py-2 text-muted-foreground">
                <GripVertical class="size-4 cursor-grab active:cursor-grabbing" aria-hidden="true" />
              </td>
              <td class="px-3 py-2 tabular-nums text-muted-foreground">{{ sortIndex + 1 }}</td>
              <td class="px-3 py-2">
                <div class="size-10 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getListThumbnailUrl(getImageUrl(row.avatar))"
                    :alt="row.name ? `${row.name} 头像` : '艺术家头像'"
                    class="size-full object-cover"
                    loading="lazy"
                  >
                </div>
              </td>
              <td class="px-3 py-2.5 font-medium">{{ row.name }}</td>
              <td class="px-3 py-2.5">
                <Badge v-if="row.institution" variant="secondary">
                  {{ row.institution.name }}
                </Badge>
                <span v-else class="text-muted-foreground">独立艺术家</span>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    :disabled="sortIndex === 0 || isSavingArtistsOrder"
                    @click="movePublicArtist(sortIndex, sortIndex - 1)"
                  >
                    上移
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    :disabled="sortIndex >= publicArtistsForSort.length - 1 || isSavingArtistsOrder"
                    @click="movePublicArtist(sortIndex, sortIndex + 1)"
                  >
                    下移
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="!publicArtistsForSort.length && !sortListLoading">
              <td colspan="6" class="px-3 py-12 text-center text-muted-foreground">
                当前范围内暂无公开艺术家
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>

    <Card v-else class="relative overflow-hidden shadow-none ring-1">
      <div
        v-if="listLoading"
        class="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[1px]"
        aria-busy="true"
        aria-label="加载中"
      >
        <Loader2 class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
      <CardContent class="overflow-x-auto p-0 sm:p-6">
        <div
          v-if="selectedArtistCount > 0"
          class="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5 sm:px-6"
        >
          <span class="text-sm text-muted-foreground tabular-nums">
            已选 {{ selectedArtistCount }} 项
          </span>
          <Button type="button" variant="outline" size="sm" @click="clearArtistSelection">
            取消选择
          </Button>
          <Button type="button" variant="destructive" size="sm" @click="openBulkDeleteArtistDialog">
            批量删除
          </Button>
        </div>
        <table class="w-full min-w-[800px] text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/40">
              <th class="h-10 w-10 px-2 text-left font-medium">
                <Checkbox
                  :model-value="allFilteredArtistsSelected ? true : someFilteredArtistsSelected ? 'indeterminate' : false"
                  aria-label="全选当前页"
                  @update:model-value="toggleSelectAllFilteredArtists"
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
                  :model-value="isArtistSelected(row.id)"
                  :aria-label="`选择 ${row.name || '艺术家'}`"
                  @update:model-value="(v) => toggleArtistSelect(row.id, v)"
                />
              </td>
              <td class="px-3 py-2">
                <div class="size-12 overflow-hidden rounded-md border border-border bg-muted/30">
                  <img
                    :src="getListThumbnailUrl(getImageUrl(row.avatar))"
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

    <Card v-if="!isArtistSortMode" class="shadow-none ring-1">
      <CardContent class="flex flex-col gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span v-if="isSearchMode && searchKeyword.trim()" class="text-sm text-muted-foreground">
          搜索结果：共 {{ pagination.total }} 条
        </span>
        <span v-else class="text-sm text-muted-foreground">共 {{ pagination.total }} 条</span>
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
      <DialogContent class="flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{{ isEdit ? '编辑艺术家' : '添加艺术家' }}</DialogTitle>
          <DialogDescription>
            <template v-if="isEdit">
              正在编辑「{{ form.name || '未命名' }}」<span v-if="form.id" class="text-muted-foreground">（ID {{ form.id }}）</span>
            </template>
            <template v-else>
              上传头像与背景图，并填写基本信息；带 <span class="text-destructive">*</span> 为必填
            </template>
          </DialogDescription>
        </DialogHeader>

        <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(240px,280px)_1fr]">
          <!-- 左侧：形象图 -->
          <div class="flex flex-col gap-5 border-border bg-muted/15 p-4 lg:border-r">
            <div class="flex flex-col gap-2">
              <Label>头像 <span class="text-destructive">*</span></Label>
              <input
                ref="avatarInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleAvatarFileSelect"
              >
              <div
                class="relative aspect-square w-full max-w-[280px] cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-background transition hover:border-primary/40"
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
                <img
                  v-if="form.avatar"
                  :src="getImageUrl(form.avatar)"
                  alt="头像"
                  class="size-full object-cover"
                  loading="lazy"
                >
                <div v-else class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <Upload class="size-9 text-muted-foreground" aria-hidden="true" />
                  <p class="text-sm font-medium">上传头像</p>
                </div>
                <div
                  v-if="isAvatarDragOver"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-sm font-medium text-primary"
                >
                  释放以上传
                </div>
                <div
                  v-if="form.avatar && !isAvatarUploading && !isAvatarProcessing"
                  class="absolute right-2 top-2 flex gap-1"
                >
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    class="size-8 bg-background/90 shadow-sm"
                    aria-label="更换头像"
                    @click.stop="triggerAvatarInput"
                  >
                    <Upload class="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    class="size-8 shadow-sm"
                    aria-label="移除头像"
                    @click.stop="clearAvatar"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                v-if="isAvatarProcessing || (avatarUploadProgress > 0 && avatarUploadProgress < 100)"
                class="max-w-[280px] rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground"
              >
                <Progress
                  :model-value="isAvatarProcessing ? 40 : avatarUploadProgress"
                  class="h-1.5"
                />
                <p class="mt-1.5 text-center">
                  {{ isAvatarProcessing ? '处理中…' : `上传中 ${avatarUploadProgress}%` }}
                </p>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <Label>背景图 <span class="text-destructive">*</span></Label>
              <input
                ref="bannerInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleBannerFileSelect"
              >
              <div
                class="relative aspect-[5/3] w-full max-w-[280px] cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-background transition hover:border-primary/40"
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
                <img
                  v-if="form.banner"
                  :src="getImageUrl(form.banner)"
                  alt="背景图"
                  class="size-full object-cover"
                  loading="lazy"
                >
                <div v-else class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <Upload class="size-9 text-muted-foreground" aria-hidden="true" />
                  <p class="text-sm font-medium">上传背景图</p>
                </div>
                <div
                  v-if="isBannerDragOver"
                  class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-sm font-medium text-primary"
                >
                  释放以上传
                </div>
                <div
                  v-if="form.banner && !isBannerUploading && !isBannerProcessing"
                  class="absolute right-2 top-2 flex gap-1"
                >
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    class="size-8 bg-background/90 shadow-sm"
                    aria-label="更换背景图"
                    @click.stop="triggerBannerInput"
                  >
                    <Upload class="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    class="size-8 shadow-sm"
                    aria-label="移除背景图"
                    @click.stop="clearBanner"
                  >
                    <X class="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div
                v-if="isBannerProcessing || (bannerUploadProgress > 0 && bannerUploadProgress < 100)"
                class="max-w-[280px] rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground"
              >
                <Progress
                  :model-value="isBannerProcessing ? 40 : bannerUploadProgress"
                  class="h-1.5"
                />
                <p class="mt-1.5 text-center">
                  {{ isBannerProcessing ? '处理中…' : `上传中 ${bannerUploadProgress}%` }}
                </p>
              </div>
            </div>
          </div>

          <!-- 右侧：Tab 表单 -->
          <div class="flex min-h-0 flex-col">
            <Tabs v-model="artistFormTab" class="flex min-h-0 flex-1 flex-col">
              <div class="shrink-0 border-b border-border px-4 pt-3">
                <TabsList class="grid h-auto w-full grid-cols-3 gap-1">
                  <TabsTrigger value="basic" class="text-xs sm:text-sm">
                    基本信息
                  </TabsTrigger>
                  <TabsTrigger value="bio" class="text-xs sm:text-sm">
                    简介与历程
                  </TabsTrigger>
                  <TabsTrigger value="featured" class="text-xs sm:text-sm">
                    代表作品
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea class="min-h-[320px] flex-1 lg:max-h-[min(56vh,560px)]">
                <TabsContent value="basic" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="artist-name">艺术家姓名 <span class="text-destructive">*</span></Label>
                    <Input id="artist-name" v-model="form.name" autocomplete="name" />
                  </div>
                  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div class="flex flex-col gap-2">
                      <Label for="artist-era">所属时代</Label>
                      <Input id="artist-era" v-model="form.era" />
                    </div>
                    <div class="flex flex-col gap-2">
                      <Label>所属机构</Label>
                      <Select
                        :model-value="form.institution_id == null ? 'none' : String(form.institution_id)"
                        @update:model-value="onInstitutionSelect"
                      >
                        <SelectTrigger class="w-full">
                          <SelectValue placeholder="选择机构" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            独立艺术家
                          </SelectItem>
                          <SelectItem
                            v-for="institution in institutions"
                            :key="institution.id"
                            :value="String(institution.id)"
                          >
                            {{ institution.name }}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label>公开接口展示</Label>
                    <p class="text-xs text-muted-foreground">
                      关闭后未登录访客无法在列表、详情与搜索中看到该艺术家
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
                </TabsContent>

                <TabsContent value="bio" class="mt-0 space-y-4 p-4">
                  <div class="flex flex-col gap-2">
                    <Label for="artist-desc">简介</Label>
                    <Textarea id="artist-desc" v-model="form.description" class="min-h-28" rows="5" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <Label for="artist-journey">艺术历程</Label>
                    <Textarea
                      id="artist-journey"
                      v-model="form.journey"
                      class="min-h-36"
                      rows="8"
                      placeholder="按时间顺序记录重要创作时期、代表作、获奖经历等"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="featured" class="mt-0 p-4">
                  <p v-if="!isEdit" class="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                    请先保存艺术家，再在编辑中配置代表作品
                  </p>
                  <div v-else class="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <Card class="shadow-none ring-1">
                      <CardHeader class="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                        <CardTitle class="text-sm font-medium">
                          全部作品（{{ filteredFeaturedAllArtworks.length }}）
                        </CardTitle>
                        <Input
                          v-model="featuredSearch"
                          class="h-8 max-w-full sm:max-w-[200px]"
                          placeholder="搜索标题 / ID / 年份"
                        />
                      </CardHeader>
                      <CardContent class="p-0">
                        <ScrollArea class="h-[280px]">
                          <div class="p-3">
                            <p
                              v-if="filteredFeaturedAllArtworks.length === 0"
                              class="py-10 text-center text-sm text-muted-foreground"
                            >
                              暂无作品或未匹配
                            </p>
                            <ul v-else class="divide-y divide-border">
                              <li
                                v-for="item in filteredFeaturedAllArtworks"
                                :key="item.id"
                                class="flex items-center gap-2 py-2.5"
                              >
                                <div
                                  v-if="item.image"
                                  class="size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
                                >
                                  <img
                                    :src="getListThumbnailUrl(getImageUrl(item.image))"
                                    :alt="item.title"
                                    class="size-full object-cover"
                                    loading="lazy"
                                  >
                                </div>
                                <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="item.title">
                                  {{ item.title || '未命名' }}
                                </span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  type="button"
                                  class="shrink-0"
                                  :disabled="featuredSelected.some((i) => i.id === item.id)"
                                  @click="featuredAdd(item)"
                                >
                                  {{ featuredSelected.some((i) => i.id === item.id) ? '已添加' : '添加' }}
                                </Button>
                              </li>
                            </ul>
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>

                    <Card class="shadow-none ring-1">
                      <CardHeader class="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                        <CardTitle class="text-sm font-medium">
                          已选（{{ featuredSelected.length }}）
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
                            :disabled="featuredSaving"
                            @click="featuredSave"
                          >
                            <Loader2
                              v-if="featuredSaving"
                              class="mr-1.5 size-3.5 animate-spin"
                              aria-hidden="true"
                            />
                            {{ featuredSaving ? '保存中…' : '保存代表作品' }}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent class="p-0">
                        <ScrollArea class="h-[280px]">
                          <div class="p-3">
                            <p
                              v-if="featuredSelected.length === 0"
                              class="py-10 text-center text-sm text-muted-foreground"
                            >
                              从左侧添加代表作品
                            </p>
                            <ul v-else class="divide-y divide-border">
                              <li
                                v-for="(item, index) in featuredSelected"
                                :key="item.id"
                                class="flex items-center gap-2 py-2.5"
                              >
                                <span class="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                                  {{ index + 1 }}
                                </span>
                                <div
                                  v-if="item.image"
                                  class="size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
                                >
                                  <img
                                    :src="getListThumbnailUrl(getImageUrl(item.image))"
                                    :alt="item.title"
                                    class="size-full object-cover"
                                    loading="lazy"
                                  >
                                </div>
                                <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="item.title">
                                  {{ item.title || '未命名' }}
                                </span>
                                <div class="flex shrink-0 gap-0.5">
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    type="button"
                                    class="size-7"
                                    :disabled="index === 0"
                                    aria-label="上移"
                                    @click="featuredMoveUp(index)"
                                  >
                                    <ChevronUp class="size-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    type="button"
                                    class="size-7"
                                    :disabled="index === featuredSelected.length - 1"
                                    aria-label="下移"
                                    @click="featuredMoveDown(index)"
                                  >
                                    <ChevronDown class="size-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    type="button"
                                    class="size-7 text-destructive hover:text-destructive"
                                    aria-label="移除"
                                    @click="featuredRemove(index)"
                                  >
                                    <X class="size-3.5" aria-hidden="true" />
                                  </Button>
                                </div>
                              </li>
                            </ul>
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        </div>

        <DialogFooter class="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" :disabled="savingForm" @click="dialogVisible = false">
            取消
          </Button>
          <Button type="button" :disabled="savingForm" @click="handleSubmit">
            <Loader2 v-if="savingForm" class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            {{ isEdit ? '保存' : '添加' }}
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
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { AlertCircle, ChevronDown, ChevronUp, GripVertical, Loader2, Search, Trash2, Upload, X } from 'lucide-vue-next'
import axios from '../utils/axios'
import { API_BASE_URL } from '../config'
import { getListThumbnailUrl } from '@/utils/listImageUrl'
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
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const route = useRoute()
const router = useRouter()

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
const artistFormTab = ref('basic')
const savingForm = ref(false)
const selectedInstitutionId = ref(null)
const searchKeyword = ref('')
const isSearchMode = ref(false)
const filteredArtists = ref([])
const featuredAllArtworks = ref([])
const featuredSelected = ref([])
const featuredSearch = ref('')
const featuredSaving = ref(false)

const artistIsPublicUpdatingId = ref(null)
const isArtistSortMode = ref(false)
const sortListLoading = ref(false)
const publicArtistsForSort = ref([])
const artistSortDragFromIndex = ref(null)
const artistSortDragOverIndex = ref(null)
const isSavingArtistsOrder = ref(false)

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
    loadArtistList()
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

const artistSortScopeLabel = computed(() => {
  if (selectedInstitutionId.value == null) return '当前范围：全部公开艺术家'
  const inst = institutions.value.find((i) => i.id === selectedInstitutionId.value)
  return inst ? `当前范围：${inst.name} 的公开艺术家` : '当前范围：所选机构的公开艺术家'
})

const artistTotalPages = computed(() =>
  Math.max(1, Math.ceil((pagination.value.total || 0) / (pagination.value.pageSize || 20)))
)

function onInstitutionSelectChange(v) {
  selectedInstitutionId.value = v === 'all' ? null : Number(v)
  pagination.value.page = 1
  clearArtistSelection()
  if (isArtistSortMode.value) {
    fetchPublicArtistsForSort()
    return
  }
  loadArtistList()
}

async function fetchPublicArtistsForSort() {
  sortListLoading.value = true
  try {
    const params = {}
    if (selectedInstitutionId.value != null) {
      params.institution_id = selectedInstitutionId.value
    }
    const res = await axios.get('/artists/public-order', { params })
    publicArtistsForSort.value = Array.isArray(res?.artists) ? res.artists : []
  } catch (e) {
    publicArtistsForSort.value = []
    ElMessage.error(e?.response?.data?.error || e?.error || '获取排序列表失败')
  } finally {
    sortListLoading.value = false
  }
}

function toggleArtistSortMode() {
  if (isArtistSortMode.value) {
    isArtistSortMode.value = false
    loadArtistList()
    return
  }
  isArtistSortMode.value = true
  fetchPublicArtistsForSort()
}

function handleArtistSortDragStart(index, event) {
  if (isSavingArtistsOrder.value) {
    event.preventDefault()
    return
  }
  artistSortDragFromIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function handleArtistSortDragEnd() {
  artistSortDragFromIndex.value = null
  artistSortDragOverIndex.value = null
}

function handleArtistSortDragOver(index, event) {
  if (artistSortDragFromIndex.value === null) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  artistSortDragOverIndex.value = index
}

function handleArtistSortDragLeave(index, event) {
  if (artistSortDragOverIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    artistSortDragOverIndex.value = null
  }
}

async function handleArtistSortDrop(toIndex, event) {
  event.preventDefault()
  const fromIndex = artistSortDragFromIndex.value
  artistSortDragFromIndex.value = null
  artistSortDragOverIndex.value = null
  if (fromIndex === null || fromIndex === toIndex) return
  await movePublicArtist(fromIndex, toIndex)
}

async function savePublicArtistsOrder(artists) {
  if (!artists?.length) return false
  isSavingArtistsOrder.value = true
  try {
    const body = { artist_ids: artists.map((a) => a.id) }
    if (selectedInstitutionId.value != null) {
      body.institution_id = selectedInstitutionId.value
    }
    const res = await axios.put('/artists/sort', body)
    if (Array.isArray(res?.artists)) {
      publicArtistsForSort.value = res.artists
    } else {
      await fetchPublicArtistsForSort()
    }
    ElMessage.success('展示顺序已保存')
    return true
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || e?.error || '保存排序失败')
    return false
  } finally {
    isSavingArtistsOrder.value = false
  }
}

async function movePublicArtist(fromIndex, toIndex) {
  const artists = [...publicArtistsForSort.value]
  if (fromIndex < 0 || fromIndex >= artists.length || toIndex < 0 || toIndex >= artists.length) return
  const previous = publicArtistsForSort.value
  const [item] = artists.splice(fromIndex, 1)
  artists.splice(toIndex, 0, item)
  publicArtistsForSort.value = artists
  const ok = await savePublicArtistsOrder(artists)
  if (!ok) publicArtistsForSort.value = previous
}

function handleArtistSearch() {
  const q = searchKeyword.value.trim()
  if (!q) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  isArtistSortMode.value = false
  isSearchMode.value = true
  pagination.value.page = 1
  clearArtistSelection()
  fetchArtistSearchResults()
}

function handleClearArtistSearch() {
  searchKeyword.value = ''
  isSearchMode.value = false
  pagination.value.page = 1
  clearArtistSelection()
  fetchArtistsList()
}

function handleArtistPageSizeChange(newSize) {
  pagination.value.pageSize = newSize
  pagination.value.page = 1
  clearArtistSelection()
  loadArtistList()
}

function handleArtistPageChange(newPage) {
  pagination.value.page = newPage
  clearArtistSelection()
  loadArtistList()
}

function loadArtistList() {
  if (isSearchMode.value && searchKeyword.value.trim()) {
    fetchArtistSearchResults()
    return
  }
  fetchArtistsList()
}

function onInstitutionSelect(value) {
  form.value.institution_id = value === 'none' || value === '' ? null : Number(value)
}

function clearAvatar() {
  form.value.avatar = ''
}

function clearBanner() {
  form.value.banner = ''
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
  loadArtistList()
}

function applyArtistPaginationFromSearch(paginationInfo) {
  if (!paginationInfo) return
  pagination.value.total = paginationInfo.total_count ?? 0
  pagination.value.page = paginationInfo.current_page ?? pagination.value.page
  pagination.value.pageSize = paginationInfo.page_size ?? pagination.value.pageSize
}

function applyArtistPaginationFromList(paginationInfo) {
  if (!paginationInfo) return
  pagination.value.total = paginationInfo.total ?? 0
  pagination.value.page = paginationInfo.page ?? pagination.value.page
  pagination.value.pageSize = paginationInfo.pageSize ?? pagination.value.pageSize
}

const fetchArtistSearchResults = async () => {
  const keyword = searchKeyword.value.trim()
  if (!keyword) return

  listLoading.value = true
  listError.value = ''
  try {
    const params = {
      keyword,
      type: 'artist',
      page: pagination.value.page,
      limit: pagination.value.pageSize,
    }
    if (selectedInstitutionId.value != null) {
      params.institution_id = selectedInstitutionId.value
    }
    const response = await axios.get('/search', { params })
    const data = response.data || []
    filteredArtists.value = Array.isArray(data) ? data : []
    applyArtistPaginationFromSearch(response.pagination)
  } catch (error) {
    console.error('搜索艺术家失败：', error)
    filteredArtists.value = []
    pagination.value.total = 0
    listError.value = '搜索失败，请检查网络或稍后重试'
  } finally {
    listLoading.value = false
  }
}

const fetchArtistsList = async () => {
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
    applyArtistPaginationFromList(paginationInfo)
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
    if (isArtistSortMode.value) await fetchPublicArtistsForSort()
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
  artistFormTab.value = 'basic'
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
  artistFormTab.value = 'basic'
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
    loadArtistList()
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
  if (!isAvatarUploading.value && !isAvatarProcessing.value) {
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

  if (isAvatarUploading.value || isAvatarProcessing.value) return

  const files = e.dataTransfer.files
  if (files.length > 0) {
    uploadAvatarFile(files[0])
  }
}

const handleBannerDragEnter = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (!isBannerUploading.value && !isBannerProcessing.value) {
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

  if (isBannerUploading.value || isBannerProcessing.value) return

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

  savingForm.value = true
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
    loadArtistList()
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    savingForm.value = false
  }
}

async function openEditFromRouteQuery() {
  const raw = route.query.edit
  if (!raw) return
  const id = Number(raw)
  if (!id) return
  await fetchArtistsList()
  const row = filteredArtists.value.find((a) => a.id === id)
  if (row) {
    handleEdit(row)
  } else {
    try {
      const detail = await axios.get(`/artists/${id}`)
      const data = detail?.data ?? detail
      if (data?.id) handleEdit(data)
    } catch {
      ElMessage.error('未找到该艺术家')
    }
  }
  const nextQuery = { ...route.query }
  delete nextQuery.edit
  router.replace({ query: nextQuery })
}

onMounted(async () => {
  pagination.value = { page: 1, pageSize: 20, total: 0 }
  fetchInstitutions()
  await fetchArtistsList()
  await openEditFromRouteQuery()
})
</script>
