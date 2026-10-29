import type { StoredTemplate, TemplateRepository } from '@/storage/templateRepository'

const databaseName = 'ai-use'
const databaseVersion = 1

interface MetaRow {
  key: string
  value: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('templates')) {
        database.createObjectStore('templates', { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
  })
}

function settleTransaction<T>(
  database: IDBDatabase,
  storeName: 'templates' | 'meta',
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, finish: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    let settled = false
    let value: T
    const fail = (error: DOMException | null) => {
      if (settled) return
      settled = true
      reject(error ?? new Error('indexedDB failed'))
    }
    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      resolve(value)
    }
    transaction.onerror = () => fail(transaction.error)
    transaction.onabort = () => fail(transaction.error)
    run(transaction.objectStore(storeName), (next) => {
      value = next
    })
  })
}

async function read<T>(
  storeName: 'templates' | 'meta',
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase()
  try {
    return await settleTransaction<T>(database, storeName, 'readonly', (store, finish) => {
      const request = run(store)
      request.onsuccess = () => finish(request.result)
    })
  } finally {
    database.close()
  }
}

async function write(storeName: 'templates' | 'meta', run: (store: IDBObjectStore) => void) {
  const database = await openDatabase()
  try {
    await settleTransaction<void>(database, storeName, 'readwrite', (store, finish) => {
      run(store)
      finish()
    })
  } finally {
    database.close()
  }
}

function normalize(
  row: StoredTemplate & {
    categoryId?: string
    categories?: { id: string; name: string; sortOrder: number }[]
  },
  stepId?: string,
): StoredTemplate {
  const legacyId = row.categoryId
  const fromCategories = Array.isArray(row.categories)
    ? row.categories.map((link) => ({
        categoryId: link.id,
        categoryName: link.name,
        stepId: '',
        stepBody: '',
        sortOrder: link.sortOrder,
      }))
    : legacyId
      ? [{ categoryId: legacyId, categoryName: '', stepId: '', stepBody: '', sortOrder: 0 }]
      : []
  const usages = Array.isArray(row.usages) ? row.usages : fromCategories
  const next = stepId
    ? [
        ...usages.filter((usage) => usage.stepId !== stepId),
        {
          categoryId: '',
          categoryName: '',
          stepId,
          stepBody: '',
          sortOrder: usages.length,
        },
      ]
    : usages
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    addedAt: row.addedAt,
    placeholders: Array.isArray(row.placeholders) ? row.placeholders : [],
    origin: row.origin,
    usages: next,
    data: row.data,
  }
}

export function createIndexedDbTemplateRepository(): TemplateRepository {
  return {
    async list() {
      const rows = await read('templates', (store) => store.getAll())
      return (rows as StoredTemplate[]).map((row) => normalize(row))
    },
    async get(id) {
      const row = await read('templates', (store) => store.get(id))
      return row ? normalize(row as StoredTemplate) : null
    },
    async put(record, stepId) {
      await write('templates', (store) => {
        store.put(normalize(record, stepId))
      })
      return { id: record.id, formatNotices: [] }
    },
    async delete(id) {
      await write('templates', (store) => {
        store.delete(id)
      })
    },
    async getMeta(key) {
      const row = await read('meta', (store) => store.get(key))
      return (row as MetaRow | undefined)?.value ?? null
    },
    async setMeta(key, value) {
      await write('meta', (store) => {
        store.put({ key, value } satisfies MetaRow)
      })
    },
  }
}
