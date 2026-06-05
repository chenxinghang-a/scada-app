<template>
  <div class="skeleton-wrapper" :class="{ animated: animate }">
    <!-- 文本行骨架 -->
    <div v-if="type === 'text'" class="skeleton-text" :style="{ width, height: '14px' }" />
    <!-- 标题骨架 -->
    <div v-else-if="type === 'title'" class="skeleton-title" :style="{ width, height: '24px' }" />
    <!-- 头像骨架 -->
    <div v-else-if="type === 'avatar'" class="skeleton-avatar" :style="{ width: size, height: size }" />
    <!-- 图片骨架 -->
    <div v-else-if="type === 'image'" class="skeleton-image" :style="{ width, height }" />
    <!-- 按钮骨架 -->
    <div v-else-if="type === 'button'" class="skeleton-button" :style="{ width, height: '36px' }" />
    <!-- 卡片骨架 -->
    <div v-else-if="type === 'card'" class="skeleton-card">
      <div class="skeleton-card-header">
        <div class="skeleton-text" style="width: 40%; height: 18px" />
        <div class="skeleton-text" style="width: 20%; height: 14px" />
      </div>
      <div class="skeleton-card-body">
        <div class="skeleton-text" style="width: 100%; height: 14px" />
        <div class="skeleton-text" style="width: 80%; height: 14px" />
        <div class="skeleton-text" style="width: 60%; height: 14px" />
      </div>
    </div>
    <!-- 表格行骨架 -->
    <div v-else-if="type === 'table-row'" class="skeleton-table-row">
      <div class="skeleton-text" style="width: 5%; height: 14px" />
      <div class="skeleton-text" style="width: 25%; height: 14px" />
      <div class="skeleton-text" style="width: 20%; height: 14px" />
      <div class="skeleton-text" style="width: 15%; height: 14px" />
      <div class="skeleton-text" style="width: 35%; height: 14px" />
    </div>
    <!-- 自定义内容骨架 -->
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * 骨架屏组件
 * 在数据加载期间展示占位符，替代空白页面。
 *
 * 用法:
 *   <SkeletonScreen type="card" />
 *   <SkeletonScreen type="table-row" :repeat="5" />
 *   <SkeletonScreen type="text" width="60%" />
 */
withDefaults(defineProps<{
  type?: 'text' | 'title' | 'avatar' | 'image' | 'button' | 'card' | 'table-row'
  width?: string
  height?: string
  size?: string
  animate?: boolean
}>(), {
  type: 'text',
  width: '100%',
  height: '100px',
  size: '48px',
  animate: true,
})
</script>

<style scoped>
.skeleton-wrapper {
  display: inline-block;
}

.skeleton-text,
.skeleton-title,
.skeleton-avatar,
.skeleton-image,
.skeleton-button {
  background: var(--el-fill-color-light, #ebeef5);
  border-radius: 4px;
}

.skeleton-title {
  border-radius: 4px;
}

.skeleton-avatar {
  border-radius: 50%;
}

.skeleton-image {
  border-radius: 8px;
}

.skeleton-button {
  border-radius: 4px;
}

.skeleton-card {
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 8px;
}

.skeleton-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.skeleton-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skeleton-table-row {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light, #f0f0f0);
}

.animated .skeleton-text,
.animated .skeleton-title,
.animated .skeleton-avatar,
.animated .skeleton-image,
.animated .skeleton-button {
  background: linear-gradient(
    90deg,
    var(--el-fill-color-light, #ebeef5) 25%,
    var(--el-fill-color, #f5f7fa) 37%,
    var(--el-fill-color-light, #ebeef5) 63%
  );
  background-size: 400% 100%;
  animation: skeleton-loading 1.4s ease infinite;
}

@keyframes skeleton-loading {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
</style>
