function readApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL
  return typeof value === 'string' ? value.trim() : ''
}

export const apiConfigured = readApiBaseUrl().length > 0
