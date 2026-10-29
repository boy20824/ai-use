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

export function createIndexedDbTemplateRepository(): TemplateRepository {
  return {
    async list() {
      const rows = await read('templates', (store) => store.getAll())
      return rows as StoredTemplate[]
    },
    async get(id) {
      const row = await read('templates', (store) => store.get(id))
      return (row as StoredTemplate | undefined) ?? null
    },
    async put(record) {
      await write('templates', (store) => {
        store.put(record)
      })
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
