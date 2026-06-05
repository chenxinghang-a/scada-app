<template>
  <div
    ref="containerRef"
    class="virtual-list"
    :style="{ height: `${height}px`, overflow: 'auto' }"
    @scroll="onScroll"
  >
    <!-- 占位撑高 -->
    <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
      <!-- 可见区域 -->
      <div
        :style="{
          position: 'absolute',
          top: `${offsetY}px`,
          left: 0,
          right: 0,
        }"
      >
        <div
          v-for="item in visibleItems"
          :key="item.index"
          :style="{ height: `${itemHeight}px` }"
          class="virtual-list-item"
        >
          <slot :item="item.data" :index="item.index" />
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="items.length === 0" class="virtual-list-empty">
      <slot name="empty">
        <el-empty description="暂无数据" :image-size="80" />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 虚拟滚动列表组件
 * 用于大量数据（1000+条）的高性能渲染，只渲染可见区域的 DOM。
 *
 * 用法:
 *   <VirtualList :items="alarms" :item-height="48" :height="600">
 *     <template #default="{ item, index }">
 *       <AlarmRow :alarm="item" />
 *     </template>
 *   </VirtualList>
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

interface Props {
  /** 数据数组 */
  items: any[]
  /** 每项高度（px） */
  itemHeight?: number
  /** 容器高度（px） */
  height?: number
  /** 预渲染缓冲区（上下各多渲染几项） */
  buffer?: number
}

const props = withDefaults(defineProps<Props>(), {
  itemHeight: 48,
  height: 600,
  buffer: 5,
})

const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)

// 总高度
const totalHeight = computed(() => props.items.length * props.itemHeight)

// 可见项数量
const visibleCount = computed(() => Math.ceil(props.height / props.itemHeight) + props.buffer * 2)

// 起始索引
const startIndex = computed(() => {
  const idx = Math.floor(scrollTop.value / props.itemHeight) - props.buffer
  return Math.max(0, idx)
})

// 结束索引
const endIndex = computed(() => {
  return Math.min(props.items.length, startIndex.value + visibleCount.value)
})

// 偏移量
const offsetY = computed(() => startIndex.value * props.itemHeight)

// 可见项
const visibleItems = computed(() => {
  const result = []
  for (let i = startIndex.value; i < endIndex.value; i++) {
    result.push({
      index: i,
      data: props.items[i],
    })
  }
  return result
})

// 滚动事件
function onScroll(e: Event) {
  const target = e.target as HTMLElement
  scrollTop.value = target.scrollTop
}

// 数据变化时重置滚动位置
watch(() => props.items.length, (newLen, oldLen) => {
  if (newLen === 0) {
    scrollTop.value = 0
  }
})
</script>

<style scoped>
.virtual-list {
  position: relative;
}

.virtual-list-item {
  box-sizing: border-box;
}

.virtual-list-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  min-height: 200px;
}
</style>
