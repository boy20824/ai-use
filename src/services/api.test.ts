import { afterEach, expect, it, vi } from 'vitest'
import { apiPagedList } from './api'

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
