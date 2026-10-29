export function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  const base = typeof configured === 'string' ? configured.trim().replace(/\/$/, '') : ''
  return `${base}${path}`
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers:
      init.body instanceof FormData
        ? init.headers
        : {
            'content-type': 'application/json',
            ...init.headers,
          },
  })
}
