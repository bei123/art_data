<template>
  <el-menu :default-active="activeMenu" class="sidebar-menu" :collapse="isCollapse" background-color="#304156"
    text-color="#bfcbd9" active-text-color="#409EFF" :router="true">

    <el-menu-item index="/">
      <el-icon>
        <Monitor />
      </el-icon>
      <template #title>仪表盘</template>
    </el-menu-item>

    <el-menu-item index="/original-artworks">
      <el-icon>
        <Picture />
      </el-icon>
      <template #title>原作管理</template>
    </el-menu-item>

    <el-menu-item index="/artists">
      <el-icon>
        <User />
      </el-icon>
      <template #title>艺术家管理</template>
    </el-menu-item>

    <el-menu-item index="/digital-artworks">
      <el-icon>
        <PictureFilled />
      </el-icon>
      <template #title>数字艺术品</template>
    </el-menu-item>

    <el-menu-item index="/physical-categories">
      <el-icon>
        <Files />
      </el-icon>
      <template #title>实物分类</template>
    </el-menu-item>

    <el-menu-item index="/rights">
      <el-icon>
        <Document />
      </el-icon>
      <template #title>权益管理</template>
    </el-menu-item>

    <el-menu-item index="/banners">
      <el-icon>
        <Picture />
      </el-icon>
      <template #title>轮播图管理</template>
    </el-menu-item>

    <el-menu-item index="/merchants">
      <el-icon>
        <Shop />
      </el-icon>
      <template #title>商家管理</template>
    </el-menu-item>

    <el-menu-item v-if="hasRole('admin')" index="/refund-approval">
      <el-icon>
        <Money />
      </el-icon>
      <template #title>退款审批</template>
    </el-menu-item>
  </el-menu>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import {
  Monitor,
  Picture,
  User,
  PictureFilled,
  Files,
  Document,
  Money,
  Shop
} from '@element-plus/icons-vue'

const route = useRoute()
const userStore = useUserStore()

console.log('userStore.userInfo:', userStore.userInfo)

const isCollapse = ref(false)
const activeMenu = computed(() => route.path)

const hasRole = (role) => {
  // 兼容 roles 数组和 role 字符串
  if (Array.isArray(userStore.userInfo?.roles)) {
    return userStore.userInfo.roles.includes(role)
  }
  if (typeof userStore.userInfo?.role === 'string') {
    return userStore.userInfo.role === role
  }
  return false
}
</script>

<style scoped>
.sidebar-menu {
  height: 100%;
  border-right: none;
}

.sidebar-menu:not(.el-menu--collapse) {
  width: 200px;
}
</style>