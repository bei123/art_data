<template>
  <el-container>
    <el-aside width="200px">
      <el-menu
        :router="true"
        default-active="/"
        class="el-menu-vertical"
      >
        <el-menu-item index="/">
          <el-icon><HomeFilled /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/original-artworks">
          <el-icon><Picture /></el-icon>
          <span>原作艺术品</span>
        </el-menu-item>
        <el-menu-item index="/artists">
          <el-icon><User /></el-icon>
          <span>艺术家</span>
        </el-menu-item>
        <el-menu-item index="/digital-artworks">
          <el-icon><Monitor /></el-icon>
          <span>数字艺术品</span>
        </el-menu-item>
        <el-menu-item index="/physical-categories">
          <el-icon><Collection /></el-icon>
          <span>实物分类</span>
        </el-menu-item>
        <el-menu-item index="/rights">
          <el-icon><Document /></el-icon>
          <span>版权实物</span>
        </el-menu-item>
        <el-menu-item index="/banners">
          <el-icon><Picture /></el-icon>
          <span>轮播图管理</span>
        </el-menu-item>
        <el-menu-item index="/merchants">
          <el-icon><Shop /></el-icon>
          <span>商家管理</span>
        </el-menu-item>
        <el-menu-item index="/digital-identity/purchases/1">
          <el-icon><Document /></el-icon>
          <span>数字身份购买记录</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header>
        <h2>艺术数据管理系统</h2>
      </el-header>
      <el-main>
        <router-view></router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { HomeFilled, Picture, Monitor, Collection, User, Document, Shop } from '@element-plus/icons-vue'
</script>

<style scoped>
.el-container {
  height: 100vh;
}
.el-aside {
  background-color: #304156;
}
.el-menu {
  border-right: none;
}
.el-header {
  background-color: #fff;
  border-bottom: 1px solid #dcdfe6;
  display: flex;
  align-items: center;
}
</style> 