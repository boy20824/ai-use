/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_TEMPLATE_STORAGE?: 'api' | 'indexeddb' | string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
