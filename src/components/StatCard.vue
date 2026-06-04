<template>
  <el-card shadow="hover">
    <div class="stat">
      <div class="stat-label">{{ label }}</div>
      <div class="stat-value">{{ displayValue }}</div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: number | string | undefined | null
  suffix?: string
  decimals?: number
}>()

const displayValue = computed(() => {
  if (props.value === undefined || props.value === null) return '-'
  if (typeof props.value === 'number') {
    const d = props.decimals ?? 0
    return props.value.toFixed(d) + (props.suffix || '')
  }
  return props.value
})
</script>

<style scoped>
.stat {
  text-align: center;
}
.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 8px;
}
.stat-value {
  font-size: 28px;
  font-weight: bold;
  color: #303133;
}
</style>
