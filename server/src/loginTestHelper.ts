import type { FastifyInstance, InjectOptions } from 'fastify'

// Follow the browser's first visit so login exercises the real CSRF cookie flow.
export async function loginWithCsrf(app: FastifyInstance, options: InjectOptions) {
  const page = await app.inject({ method: 'GET', url: '/login' })
  const csrf = page.cookies.find((cookie) => cookie.name === 'csrf')!
  const response = await app.inject({
    ...options,
    cookies: { csrf: csrf.value, ...options.cookies },
    headers: { 'x-csrf-token': csrf.value, ...options.headers },
  })
  return { ...response, cookies: [...response.cookies, csrf] }
}
