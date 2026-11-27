import { afterEach, expect, it, vi } from 'vitest'
import { apiErrorMessage, apiPagedList, apiRequest } from './api'

afterEach(() => vi.unstubAllGlobals())
it.each([
  ['/api/templates', 'templates'],
  ['/api/feedback?status=done', 'posts'],
])('loads all bounded pages for %s without losing the existing UI list', async (path, key) => {
  const first = Array.from({ length: 100 }, (_, id) => ({ id }))
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ [key]: first }))
    .mockResolvedValueOnce(Response.json({ [key]: [{ id: 100 }] }))
  vi.stubGlobal('fetch', request)
  expect(await apiPagedList(path, key, 'failed')).toHaveLength(101)
  expect(request.mock.calls[0]![0]).toContain('limit=100&offset=0')
  expect(request.mock.calls[1]![0]).toContain('limit=100&offset=100')
  if (key === 'posts') expect(request.mock.calls[1]![0]).toContain('status=done&')
})
it('reports an error on a subsequent page instead of silently dropping rows', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ posts: Array(100).fill({}) }))
      .mockResolvedValueOnce(Response.json({ message: 'failed' }, { status: 503 })),
  )
  await expect(apiPagedList('/api/feedback', 'posts', 'failed')).rejects.toThrow('failed')
})

it('sends the CSRF cookie as a header when logging in', async () => {
  vi.stubGlobal('document', { cookie: 'csrf=mock-csrf-token' })
  const request = vi.fn().mockResolvedValue(Response.json({ user: { username: 'mock' } }))
  vi.stubGlobal('fetch', request)
  await apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'mock', password: 'short' }),
  })
  const [url, options] = request.mock.calls[0]!
  expect(url).toBe('/api/auth/login')
  expect(options.credentials).toBe('include')
  expect(options.headers.get('x-csrf-token')).toBe('mock-csrf-token')
})

it.each([
  ['這個類別名稱已經存在。', '這個案件範本名稱已經存在。'],
  ['不可跨案類引用。', '不可跨案件範本使用步驟。'],
  ['步驟仍被引用，請先移除引用。', '這個步驟仍在使用中，請先從使用它的地方拿掉。'],
  ['只有系統管理員可以刪除實體。', '只有系統管理員可以刪除步驟或情境。'],
])('shows friendly frontend copy for a legacy API error', async (message, friendly) => {
  expect(await apiErrorMessage(Response.json({ message }), 'Mock fallback')).toBe(friendly)
})
