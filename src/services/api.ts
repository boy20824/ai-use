export function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  const base = typeof configured === 'string' ? configured.trim().replace(/\/$/, '') : ''
  return `${base}${path}`
}

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

export async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) return body.message
  } catch {
    // The response had no JSON body.
  }
  return fallback
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const token = csrfToken()
    if (token) headers.set('x-csrf-token', token)
  }
  return fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  })
}

/** Load bounded server pages while retaining the existing complete-list UI. */
export async function apiPagedList<T>(path: string, key: string, fallback: string): Promise<T[]> {
  const items: T[] = []
  for (let offset = 0; ; offset += 100) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await apiRequest(`${path}${separator}limit=100&offset=${offset}`)
    if (!response.ok) throw new Error(await apiErrorMessage(response, fallback))
    const body = (await response.json()) as Record<string, T[]>
    const page = body[key]
    if (!Array.isArray(page) || page.length > 100) throw new Error(fallback)
    items.push(...page)
    if (page.length < 100) return items
  }
}
