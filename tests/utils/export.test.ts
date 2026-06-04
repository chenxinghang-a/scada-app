import { describe, it, expect } from 'vitest'
import { escCSV } from '@/utils/export'

describe('escCSV', () => {
  it('returns plain string unchanged', () => {
    expect(escCSV('hello')).toBe('hello')
  })

  it('escapes comma', () => {
    expect(escCSV('a,b')).toBe('"a,b"')
  })

  it('escapes double quote', () => {
    expect(escCSV('a"b')).toBe('"a""b"')
  })

  it('escapes newline', () => {
    expect(escCSV('a\nb')).toBe('"a\nb"')
  })

  it('handles null', () => {
    expect(escCSV(null)).toBe('')
  })

  it('handles undefined', () => {
    expect(escCSV(undefined)).toBe('')
  })

  it('converts number to string', () => {
    expect(escCSV(42)).toBe('42')
  })

  it('handles empty string', () => {
    expect(escCSV('')).toBe('')
  })

  it('escapes multiple special chars', () => {
    expect(escCSV('a,"b"\nc')).toBe('"a,""b""\nc"')
  })
})
