import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDebounce, useDebouncedRef, useFormSubmit } from '@/composables/useDebounce'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useDebounce', () => {
  it('delays function execution', () => {
    const fn = vi.fn()
    const { debouncedFn } = useDebounce(fn, 300)

    debouncedFn()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('resets timer on repeated calls', () => {
    const fn = vi.fn()
    const { debouncedFn } = useDebounce(fn, 300)

    debouncedFn()
    vi.advanceTimersByTime(200)
    debouncedFn()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('passes arguments to original function', () => {
    const fn = vi.fn()
    const { debouncedFn } = useDebounce(fn, 100)

    debouncedFn('a', 'b')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledWith('a', 'b')
  })

  it('cancel prevents execution', () => {
    const fn = vi.fn()
    const { debouncedFn, cancel } = useDebounce(fn, 300)

    debouncedFn()
    cancel()
    vi.advanceTimersByTime(300)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('useDebouncedRef', () => {
  it('returns initial value immediately', () => {
    const { debouncedValue } = useDebouncedRef('init', 300)
    expect(debouncedValue.value).toBe('init')
  })

  it('delays value update', () => {
    const { debouncedValue, set } = useDebouncedRef('init', 300)

    set('new')
    expect(debouncedValue.value).toBe('init')

    vi.advanceTimersByTime(300)
    expect(debouncedValue.value).toBe('new')
  })

  it('resets timer on repeated set', () => {
    const { debouncedValue, set } = useDebouncedRef('init', 300)

    set('a')
    vi.advanceTimersByTime(200)
    set('b')
    vi.advanceTimersByTime(200)
    expect(debouncedValue.value).toBe('init')

    vi.advanceTimersByTime(100)
    expect(debouncedValue.value).toBe('b')
  })

  it('cancel prevents update', () => {
    const { debouncedValue, set, cancel } = useDebouncedRef('init', 300)

    set('new')
    cancel()
    vi.advanceTimersByTime(300)
    expect(debouncedValue.value).toBe('init')
  })
})

describe('useFormSubmit', () => {
  it('prevents double submit within delay', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { submit } = useFormSubmit(fn, 1000)

    await submit()
    await submit() // should be ignored
    expect(fn).toHaveBeenCalledOnce()
  })

  it('allows submit after delay', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { submit } = useFormSubmit(fn, 1000)

    await submit()
    vi.advanceTimersByTime(1000)
    await submit()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('sets loading state', async () => {
    let resolvePromise: () => void
    const fn = vi.fn().mockImplementation(() => new Promise<void>(r => { resolvePromise = r }))
    const { loading, submit } = useFormSubmit(fn, 0)

    expect(loading.value).toBe(false)
    const submitPromise = submit()
    expect(loading.value).toBe(true)

    resolvePromise!()
    await submitPromise
    expect(loading.value).toBe(false)
  })

  it('allows submit after loading completes', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const { submit } = useFormSubmit(fn, 0)

    await submit()
    await submit()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
