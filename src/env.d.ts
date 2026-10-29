/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_TEMPLATE_STORAGE?: 'api' | 'indexeddb' | string
  readonly VITE_SEED_SAMPLE_DATA?: string
  readonly VITE_SEED_DEMO_USERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
