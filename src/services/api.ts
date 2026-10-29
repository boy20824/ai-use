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
