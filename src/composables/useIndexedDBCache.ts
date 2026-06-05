/**
 * IndexedDB缓存策略 Composable
 * 离线数据持久化，支持TTL、LRU淘汰、容量限制。
 *
 * 用法:
 *   const { get, set, remove, clear, stats } = useIndexedDBCache('scada-cache')
 *   await set('devices', devicesData, { ttl: 60000 })
 *   const data = await get('devices')
 */

import { ref, computed } from 'vue'

interface CacheEntry {
  key: string
  value: any
  timestamp: number
  ttl: number
  size: number
  accessCount: number
  lastAccess: number
}

interface CacheStats {
  entries: number
  totalSize: number
  hitRate: number
  missRate: number
}

const DB_NAME = 'scada-cache'
const DB_VERSION = 1
const STORE_NAME = 'cache'
const MAX_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_ENTRIES = 1000

export function useIndexedDBCache(storeName: string = STORE_NAME) {
  let db: IDBDatabase | null = null
  const isReady = ref(false)
  let hits = 0
  let misses = 0

  /** 打开数据库 */
  async function openDB(): Promise<IDBDatabase> {
    if (db) return db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'key' })
          store.createIndex('timestamp', 'timestamp')
          store.createIndex('lastAccess', 'lastAccess')
        }
      }

      request.onsuccess = (event) => {
        db = (event.target as IDBOpenDBRequest).result
        isReady.value = true
        resolve(db)
      }

      request.onerror = () => reject(request.error)
    })
  }

  /** 获取缓存 */
  async function get<T = any>(key: string): Promise<T | null> {
    try {
      const database = await openDB()
      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly')
        const store = tx.objectStore(storeName)
        const request = store.get(key)

        request.onsuccess = () => {
          const entry = request.result as CacheEntry | undefined
          if (!entry) {
            misses++
            resolve(null)
            return
          }

          // 检查TTL
          if (entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl) {
            misses++
            // 异步删除过期条目
            remove(key)
            resolve(null)
            return
          }

          hits++
          // 更新访问信息
          entry.accessCount++
          entry.lastAccess = Date.now()
          updateEntry(entry)

          resolve(entry.value as T)
        }

        request.onerror = () => reject(request.error)
      })
    } catch (e) {
      console.warn('[IndexedDB] get失败:', e)
      misses++
      return null
    }
  }

  /** 设置缓存 */
  async function set(key: string, value: any, options: { ttl?: number } = {}): Promise<void> {
    try {
      const database = await openDB()
      const size = estimateSize(value)

      const entry: CacheEntry = {
        key,
        value,
        timestamp: Date.now(),
        ttl: options.ttl || 0,
        size,
        accessCount: 0,
        lastAccess: Date.now(),
      }

      // 检查容量
      await evictIfNeeded(database, size)

      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        const request = store.put(entry)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (e) {
      console.warn('[IndexedDB] set失败:', e)
    }
  }

  /** 删除缓存 */
  async function remove(key: string): Promise<void> {
    try {
      const database = await openDB()
      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        const request = store.delete(key)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (e) {
      console.warn('[IndexedDB] remove失败:', e)
    }
  }

  /** 清空缓存 */
  async function clear(): Promise<void> {
    try {
      const database = await openDB()
      return new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        const request = store.clear()

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (e) {
      console.warn('[IndexedDB] clear失败:', e)
    }
  }

  /** 更新访问信息 */
  async function updateEntry(entry: CacheEntry): Promise<void> {
    try {
      const database = await openDB()
      const tx = database.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.put(entry)
    } catch {}
  }

  /** 容量淘汰 */
  async function evictIfNeeded(database: IDBDatabase, newSize: number): Promise<void> {
    const stats = await getStatsFromDB(database)
    if (stats.entries < MAX_ENTRIES && stats.totalSize + newSize < MAX_SIZE) return

    // LRU淘汰
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const index = store.index('lastAccess')
      const request = index.openCursor()
      let deleted = 0

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && (stats.entries - deleted >= MAX_ENTRIES * 0.8)) {
          cursor.delete()
          deleted++
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => resolve() // 不阻塞
    })
  }

  /** 估算对象大小 */
  function estimateSize(value: any): number {
    try {
      return new Blob([JSON.stringify(value)]).size
    } catch {
      return 0
    }
  }

  /** 获取统计 */
  async function getStatsFromDB(database?: IDBDatabase): Promise<CacheStats> {
    try {
      const db = database || await openDB()
      return new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readonly')
        const store = tx.objectStore(storeName)
        const request = store.getAll()

        request.onsuccess = () => {
          const entries = request.result as CacheEntry[]
          const totalSize = entries.reduce((sum, e) => sum + e.size, 0)
          const total = hits + misses
          resolve({
            entries: entries.length,
            totalSize,
            hitRate: total > 0 ? hits / total : 0,
            missRate: total > 0 ? misses / total : 0,
          })
        }

        request.onerror = () => resolve({ entries: 0, totalSize: 0, hitRate: 0, missRate: 0 })
      })
    } catch {
      return { entries: 0, totalSize: 0, hitRate: 0, missRate: 0 }
    }
  }

  const stats = ref<CacheStats>({ entries: 0, totalSize: 0, hitRate: 0, missRate: 0 })

  async function refreshStats() {
    stats.value = await getStatsFromDB()
  }

  return {
    isReady,
    stats,
    get,
    set,
    remove,
    clear,
    refreshStats,
  }
}
