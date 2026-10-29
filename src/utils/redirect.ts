export function safeRedirect(value: unknown): string {
  const target = Array.isArray(value) ? value[0] : value
  if (typeof target !== 'string') return '/'
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/'
  if (target === '/login' || target.startsWith('/login?') || target.startsWith('/login/'))
    return '/'
  if (target.includes('\\') || target.includes('://')) return '/'
  return target
}
