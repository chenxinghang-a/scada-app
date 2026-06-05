/**
 * 图表数据智能降采样算法
 * 大数据量时保持视觉特征的同时减少数据点。
 *
 * 算法:
 * - LTTB (Largest Triangle Three Buckets): 保留视觉特征的最佳算法
 * - 均匀采样: 简单均匀间隔
 * - 自适应: 根据数据波动自动选择算法
 */

export interface SampledData {
  data: [number, number][]
  originalCount: number
  sampledCount: number
  ratio: number
}

/**
 * LTTB (Largest Triangle Three Buckets) 降采样
 * 保留数据的视觉特征（峰谷、趋势变化）
 */
export function lttbDownsample(
  data: [number, number][],
  targetCount: number
): [number, number][] {
  if (data.length <= targetCount) return data
  if (targetCount < 3) return data.slice(0, targetCount)

  const result: [number, number][] = []
  result.push(data[0]) // 第一个点

  const bucketSize = (data.length - 2) / (targetCount - 2)

  let prevIndex = 0

  for (let i = 1; i < targetCount - 1; i++) {
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1
    const bucketEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1)

    // 计算下一个bucket的平均点
    const nextBucketStart = Math.floor(i * bucketSize) + 1
    const nextBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1)
    let avgX = 0, avgY = 0
    const nextBucketLen = nextBucketEnd - nextBucketStart
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgX += data[j][0]
      avgY += data[j][1]
    }
    avgX /= nextBucketLen
    avgY /= nextBucketLen

    // 在当前bucket中找到面积最大的点
    let maxArea = -1
    let maxIndex = bucketStart

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (data[prevIndex][0] - avgX) * (data[j][1] - data[prevIndex][1]) -
        (data[prevIndex][0] - data[j][0]) * (avgY - data[prevIndex][1])
      )
      if (area > maxArea) {
        maxArea = area
        maxIndex = j
      }
    }

    result.push(data[maxIndex])
    prevIndex = maxIndex
  }

  result.push(data[data.length - 1]) // 最后一个点
  return result
}

/**
 * 均匀降采样
 */
export function uniformDownsample(
  data: [number, number][],
  targetCount: number
): [number, number][] {
  if (data.length <= targetCount) return data

  const step = data.length / targetCount
  const result: [number, number][] = []

  for (let i = 0; i < targetCount; i++) {
    const index = Math.min(Math.floor(i * step), data.length - 1)
    result.push(data[index])
  }

  return result
}

/**
 * 自适应降采样
 * 根据数据特征自动选择算法
 */
export function adaptiveDownsample(
  data: [number, number][],
  targetCount: number
): SampledData {
  if (data.length <= targetCount) {
    return {
      data,
      originalCount: data.length,
      sampledCount: data.length,
      ratio: 1,
    }
  }

  // 计算数据波动性（标准差）
  const values = data.map(d => d[1])
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)
  const cv = mean !== 0 ? stdDev / Math.abs(mean) : 0

  // 波动大用LTTB（保留特征），波动小用均匀采样
  const useLTTB = cv > 0.1 || data.length > targetCount * 10
  const sampled = useLTTB
    ? lttbDownsample(data, targetCount)
    : uniformDownsample(data, targetCount)

  return {
    data: sampled,
    originalCount: data.length,
    sampledCount: sampled.length,
    ratio: sampled.length / data.length,
  }
}

/**
 * 时间序列降采样
 * 保留时间间隔的均匀性
 */
export function timeSeriesDownsample(
  data: [number, number][],
  targetCount: number
): [number, number][] {
  if (data.length <= targetCount) return data

  // 对于时间序列，优先使用LTTB保持趋势
  return lttbDownsample(data, targetCount)
}

/**
 * 实时数据滑动窗口采样
 * 保留最近N个点，旧数据降采样
 */
export function slidingWindowSample(
  data: [number, number][],
  maxPoints: number,
  recentRatio: number = 0.3
): [number, number][] {
  if (data.length <= maxPoints) return data

  const recentCount = Math.floor(maxPoints * recentRatio)
  const oldCount = maxPoints - recentCount

  // 最近的数据保留原始精度
  const recent = data.slice(-recentCount)

  // 旧数据降采样
  const oldData = data.slice(0, -recentCount)
  const oldSampled = lttbDownsample(oldData, oldCount)

  return [...oldSampled, ...recent]
}
