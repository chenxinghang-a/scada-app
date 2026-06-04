import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCache } from '@/composables/useCache'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCache', () => {
  it('stores and retrieves values', () => {
    const cache = useCache<string>('test-basic')
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  it('returns null for missing keys', () => {
    const cache = useCache<string>('test-missing')
    expect(cache.get('nonexistent')).toBeNull()
  })

  it('respects TTL expiry', () => {
    const cache = useCache<string>('test-ttl', { ttl: 1000 })
    cache.set('key1', 'value1')

    expect(cache.get('key1')).toBe('value1')

    vi.advanceTimersByTime(1001)
    expect(cache.get('key1')).toBeNull()
  })

  it('has() returns false for expired entries', () => {
    const cache = useCache<string>('test-has', { ttl: 500 })
    cache.set('key1', 'value1')

    expect(cache.has('key1')).toBe(true)
    vi.advanceTimersByTime(501)
    expect(cache.has('key1')).toBe(false)
  })

  it('isStale() returns true for expired entries', () => {
    const cache = useCache<string>('test-stale', { ttl: 500 })
    cache.set('key1', 'value1')

    expect(cache.isStale('key1')).toBe(false)
    vi.advanceTimersByTime(501)
    expect(cache.isStale('key1')).toBe(true)
  })

  it('respects maxSize by evicting oldest', () => {
    const cache = useCache<string>('test-maxsize', { maxSize: 3 })

    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    cache.set('d', '4') // should evict 'a'

    expect(cache.get('a')).toBeNull()
    expect(cache.get('d')).toBe('4')
  })

  it('remove() deletes a key', () => {
    const cache = useCache<string>('test-remove')
    cache.set('key1', 'value1')
    cache.remove('key1')
    expect(cache.get('key1')).toBeNull()
  })

  it('clear() removes all entries', () => {
    const cache = useCache<string>('test-clear')
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBeNull()
  })

  it('getOrFetch returns cached value if not stale', async () => {
    const cache = useCache<string>('test-fetch', { ttl: 5000 })
    const fetcher = vi.fn().mockResolvedValue('fresh')

    cache.set('key1', 'cached')
    const result = await cache.getOrFetch('key1', fetcher)

    expect(result).toBe('cached')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('getOrFetch calls fetcher when stale', async () => {
    const cache = useCache<string>('test-fetch-stale', { ttl: 500 })
    const fetcher = vi.fn().mockResolvedValue('fresh')

    cache.set('key1', 'old')
    vi.advanceTimersByTime(501)

    const result = await cache.getOrFetch('key1', fetcher)
    expect(result).toBe('fresh')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('getOrFetch with forceRefresh ignores cache', async () => {
    const cache = useCache<string>('test-force', { ttl: 60000 })
    const fetcher = vi.fn().mockResolvedValue('new')

    cache.set('key1', 'old')
    const result = await cache.getOrFetch('key1', fetcher, true)

    expect(result).toBe('new')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('namespaces are isolated', () => {
    const cache1 = useCache<string>('ns1')
    const cache2 = useCache<string>('ns2')

    cache1.set('key', 'value1')
    cache2.set('key', 'value2')

    expect(cache1.get('key')).toBe('value1')
    expect(cache2.get('key')).toBe('value2')
  })
})
