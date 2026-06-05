/**
 * 组件懒加载 Composable
 * 按需加载+预加载，减少初始bundle大小。
 *
 * 用法:
 *   const { load, preload, isLoaded, component } = useLazyComponent(
 *     () => import('./HeavyComponent.vue'),
 *     { preload: true, timeout: 10000 }
 *   )
 */

import { ref, defineAsyncComponent, type Component, type AsyncComponentLoader } from 'vue'

interface LazyComponentOptions {
  /** 是否自动预加载 */
  preload?: boolean
  /** 加载超时（ms） */
  timeout?: number
  /** 加载失败时的降级组件 */
  fallback?: Component
  /** 加载中的组件 */
  loading?: Component
  /** 延迟加载（ms） */
  delay?: number
  /** 重试次数 */
  retries?: number
}

export function useLazyComponent(
  loader: AsyncComponentLoader,
  options: LazyComponentOptions = {}
) {
  const {
    preload = false,
    timeout = 30000,
    fallback,
    loading,
    delay = 200,
    retries = 3,
  } = options

  const isLoaded = ref(false)
  const isLoading = ref(false)
  const loadError = ref<Error | null>(null)
  const loadStartTime = ref(0)

  // 缓存加载的组件
  let cachedComponent: Component | null = null
  let loadPromise: Promise<Component> | null = null

  async function load(): Promise<Component> {
    if (cachedComponent) return cachedComponent
    if (loadPromise) return loadPromise

    isLoading.value = true
    loadStartTime.value = Date.now()
    loadError.value = null

    loadPromise = (async () => {
      let lastError: Error | null = null

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const mod = await loader()
          const component = mod.default || mod

          cachedComponent = component
          isLoaded.value = true
          isLoading.value = false

          const duration = Date.now() - loadStartTime.value
          console.debug(`[LazyComponent] 加载完成: ${duration}ms`)

          return component
        } catch (err: any) {
          lastError = err
          console.warn(`[LazyComponent] 加载失败 (尝试 ${attempt + 1}/${retries + 1}):`, err.message)

          if (attempt < retries) {
            // 指数退避
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
          }
        }
      }

      loadError.value = lastError
      isLoading.value = false
      loadPromise = null

      throw lastError
    })()

    return loadPromise
  }

  // 创建异步组件
  const asyncComponent = defineAsyncComponent({
    loader: async () => {
      try {
        return await load()
      } catch {
        if (fallback) return fallback
        // 返回空组件
        return { template: '<div></div>' }
      }
    },
    loadingComponent: loading,
    delay,
    timeout,
    suspensible: false,
  })

  // 预加载
  function preloadComponent() {
    if (!cachedComponent && !loadPromise) {
      load().catch(() => {}) // 静默失败
    }
  }

  // 卸载缓存
  function unload() {
    cachedComponent = null
    loadPromise = null
    isLoaded.value = false
    loadError.value = null
  }

  // 自动预加载
  if (preload) {
    // 使用 requestIdleCallback 在空闲时预加载
    if (typeof window !== 'undefined') {
      const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 100))
      ric(() => preloadComponent())
    }
  }

  return {
    component: asyncComponent,
    isLoaded,
    isLoading,
    loadError,
    load,
    preload: preloadComponent,
    unload,
  }
}