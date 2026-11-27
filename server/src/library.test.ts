import { docxMimeType } from '../../shared/templateUpload.ts'
import { loginWithCsrf } from './loginTestHelper.ts'
import {
  buildMinimalDocx,
  makeConfig,
  testOrigin as origin,
  testPasswords as passwords,
  testSamplePath as samplePath,
} from './testSupport.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import PizZip from 'pizzip'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { seedSampleEnabled } from './config.ts'
import { createQueries, migrate, openDatabase, type AppDatabase } from './db.ts'
import { seedReferenceData } from './seed.ts'
import { buildPhotoTemplate } from '../../shared/photoTemplateFixture.ts'
import { mockPhotoDraft, mockPhotoFields } from '../../shared/photoMock.ts'
import { renderPhotoDocx } from '../../shared/photoBlockRender.ts'

const scratch = mkdtempSync(path.join(tmpdir(), 'ai-use-library-'))

function multipart(fileName: string, data: Uint8Array, stepId?: string) {
  const boundary = '----library'
  const chunks: Uint8Array[] = []
  if (stepId) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="stepId"\r\n\r\n${stepId}\r\n`,
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${docxMimeType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function boot() {
  const db = openDatabase(':memory:')
  migrate(db)
  seedReferenceData(
    createQueries(db),
    passwords,
    samplePath,
    makeConfig({ scratch }).uploadDir,
    false,
  )
  const app = await buildApp(db, makeConfig({ scratch }))
  return { app, db }
}

function auth(response: { cookies: { name: string; value: string }[] }) {
  const session = response.cookies.find((cookie) => cookie.name === 'session')?.value ?? ''
  const csrf = response.cookies.find((cookie) => cookie.name === 'csrf')?.value ?? ''
  return {
    cookies: { session, csrf },
    headers: { origin, 'x-csrf-token': csrf },
  }
}

describe('category library', () => {
  const databases: AppDatabase[] = []
  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })

  it('counts only base and scenario references, even with a saved combination order', async () => {
    const { app, db } = await boot()
    databases.push(db)
    try {
      const admin = auth(
        await loginWithCsrf(app, {
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'admin', password: passwords.admin },
        }),
      )
      const created = await app.inject({
        method: 'POST',
        url: '/api/categories',
        ...admin,
        payload: {
          name: 'Mock case',
          variants: [
            { id: 'scene', name: 'Mock scenario' },
            { id: 'shared', name: 'Mock shared scenario' },
          ],
          steps: [
            { id: 'base', body: 'Mock base' },
            { id: 'module-only', body: 'Mock scenario step', variantIds: ['scene', 'shared'] },
            { id: 'removed', body: 'Mock removed step' },
          ],
        },
      })
      expect(created.statusCode, created.body).toBe(201)
      const category = created.json().category
      const url = `/api/categories/${category.id}`
      const [base, moduleOnly, removed] = category.steps.map((step: { id: string }) => step.id)
      const upload = async (fileName: string, stepId: string) => {
        const form = multipart(fileName, buildMinimalDocx('Mock content'), stepId)
        const response = await app.inject({
          method: 'POST',
          url: '/api/templates',
          cookies: admin.cookies,
          headers: { ...admin.headers, ...form.headers },
          payload: form.payload,
        })
        expect(response.statusCode, response.body).toBe(201)
        return response.json().template.id as string
      }
      const shared = await upload('scene-photos-template.docx', base)
      const orphanOnly = await upload('mock-orphan-only.docx', removed)
      for (const id of [moduleOnly, removed]) {
        const linked = await app.inject({
          method: 'PATCH',
          url: `${url}/steps/${id}`,
          ...admin,
          payload: { templateIds: id === removed ? [orphanOnly, shared] : [shared] },
        })
        expect(linked.statusCode, linked.body).toBe(200)
      }
      const combination = await app.inject({
        method: 'PUT',
        url: `${url}/combination-order`,
        ...admin,
        payload: { moduleIds: ['scene', 'shared'], stepIds: [moduleOnly, removed, base] },
      })
      expect(combination.statusCode, combination.body).toBe(200)
      const list = async (categoryId?: string) => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/templates',
          ...admin,
          ...(categoryId ? { query: { categoryId } } : {}),
        })
        expect(response.statusCode, response.body).toBe(200)
        return response.json().templates as {
          id: string
          linkedCategoryCount: number
          usages: { categoryId: string; stepId: string }[]
        }[]
      }
      const removeRef = async (scope: string, stepId: string) => {
        const response = await app.inject({
          method: 'DELETE',
          url: `${url}/refs/${scope}/${stepId}`,
          ...admin,
        })
        expect(response.statusCode, response.body).toBe(200)
        return response.json().category
      }
      const expectSharedSteps = async (...stepIds: string[]) => {
        const template = (await list()).find((item) => item.id === shared)!
        expect(template.usages.map((usage) => [usage.categoryId, usage.stepId])).toEqual(
          stepIds.map((id) => [category.id, id]),
        )
        expect(template.linkedCategoryCount).toBe(stepIds.length ? 1 : 0)
      }

      await expectSharedSteps(base, moduleOnly, removed)
      const afterRemove = await removeRef('base', removed)
      expect(
        afterRemove.steps.find((step: { id: string }) => step.id === removed).templateIds,
      ).toEqual([orphanOnly, shared])
      expect(afterRemove.combinationOrders[0].stepIds).toContain(removed)
      await expectSharedSteps(base, moduleOnly)
      expect(afterRemove.templateCount).toBe(2)
      expect((await list()).find((item) => item.id === orphanOnly)).toMatchObject({
        linkedCategoryCount: 0,
        usages: [],
      })
      expect((await list(category.id)).map((item) => item.id)).toEqual([shared])

      const deletedStep = await app.inject({
        method: 'DELETE',
        url: `${url}/steps/${removed}`,
        ...admin,
        payload: { confirm: true },
      })
      expect(deletedStep.statusCode, deletedStep.body).toBe(204)
      expect(createQueries(db).stepImpact(removed).templates).toEqual([])
      await expectSharedSteps(base, moduleOnly)
      await removeRef('scene', moduleOnly)
      await expectSharedSteps(base, moduleOnly)
      const deletedCategory = await app.inject({ method: 'DELETE', url, ...admin })
      expect(deletedCategory.statusCode, deletedCategory.body).toBe(204)
      await expectSharedSteps()
      expect(createQueries(db).stepImpact(moduleOnly).templates).toEqual([])
      expect(await list()).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  it('accepts the Mock photo template and generated 2/5/7-photo documents via the real upload route, and reports syntax positions', async () => {
    const { app, db } = await boot()
    databases.push(db)
    try {
      const admin = auth(
        await loginWithCsrf(app, {
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'admin', password: passwords.admin },
        }),
      )
      const template = buildPhotoTemplate()
      for (const [name, data] of [
        ['photo-template.docx', template],
        ...[2, 5, 7].map(
          (count) =>
            [
              `mock-${count}.docx`,
              renderPhotoDocx(template, mockPhotoFields, mockPhotoDraft(count)),
            ] as const,
        ),
      ] as const) {
        const form = multipart(name, data)
        const response = await app.inject({
          method: 'POST',
          url: '/api/templates',
          cookies: admin.cookies,
          headers: { ...admin.headers, ...form.headers },
          payload: form.payload,
        })
        expect(response.statusCode, response.body).toBe(201)
      }
      const broken = new PizZip(template)
      broken.file(
        'word/document.xml',
        broken.file('word/document.xml')!.asText().replace('{{/照片頁}}', ''),
      )
      const form = multipart('broken.docx', broken.generate({ type: 'uint8array' }))
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/templates',
        cookies: admin.cookies,
        headers: { ...admin.headers, ...form.headers },
        payload: form.payload,
      })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().message).toMatch(/照片頁缺少結尾.*第 \d+ 個標記，第 \d+ 段/)
    } finally {
      await app.close()
    }
  })

  it('keeps the sample template behind a non-production flag and never seeds categories', () => {
    expect(seedSampleEnabled('production', 'true', 'true')).toBe(false)
    expect(seedSampleEnabled('development', 'true', undefined)).toBe(true)
    expect(seedSampleEnabled('development', 'false', 'true')).toBe(true)
    expect(seedSampleEnabled('development', undefined, undefined)).toBe(false)

    const quiet = openDatabase(':memory:')
    databases.push(quiet)
    migrate(quiet)
    seedReferenceData(
      createQueries(quiet),
      passwords,
      samplePath,
      makeConfig({ scratch }).uploadDir,
      false,
    )
    const quietQueries = createQueries(quiet)
    expect(quietQueries.listCategories()).toEqual([])
    expect(quietQueries.hasTemplate('sample-field-note')).toBe(false)
    expect(quietQueries.countUsers()).toBe(3)

    const sampled = openDatabase(':memory:')
    databases.push(sampled)
    migrate(sampled)
    const sampleDir = makeConfig({ scratch }).uploadDir
    seedReferenceData(createQueries(sampled), passwords, samplePath, sampleDir, true)
    const sample = createQueries(sampled).getTemplateFile('sample-field-note')
    expect(sample?.origin).toBe('sample')
    expect(sample?.usages).toEqual([])
    expect(createQueries(sampled).listCategories()).toEqual([])
  })

  it('creates, edits, links, and deletes categories without removing template files', async () => {
    const { app, db } = await boot()
    databases.push(db)
    const clerk = auth(
      await loginWithCsrf(app, {
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'clerk', password: passwords.clerk },
      }),
    )
    const admin = auth(
      await loginWithCsrf(app, {
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: passwords.admin },
      }),
    )
    const viewer = auth(
      await loginWithCsrf(app, {
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'viewer', password: passwords.viewer },
      }),
    )

    const probe = await app.inject({ method: 'GET', url: '/api/categories' })
    expect(probe.statusCode).toBe(401)
    const csrf = probe.cookies.find((cookie) => cookie.name === 'csrf')?.value ?? ''
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/categories',
      cookies: { csrf },
      headers: { origin, 'x-csrf-token': csrf },
      payload: { name: '竊盜案' },
    })
    expect(anonymous.statusCode).toBe(401)

    const missingToken = await app.inject({
      method: 'POST',
      url: '/api/categories',
      cookies: { session: clerk.cookies.session },
      headers: { origin },
      payload: { name: '竊盜案' },
    })
    expect(missingToken.statusCode).toBe(403)
    expect(missingToken.json().error).toBe('csrf')

    const viewerCreate = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...viewer,
      payload: { name: '竊盜案' },
    })
    expect(viewerCreate.statusCode).toBe(403)

    const blank = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...admin,
      payload: { name: '   ' },
    })
    expect(blank.statusCode).toBe(400)
    expect(blank.json().message).toBe('請填寫類別名稱。')

    const extra = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...admin,
      payload: { name: '竊盜案', audience: '不該有' },
    })
    expect(extra.statusCode).toBe(400)

    const injectedName = "竊盜'; DROP TABLE categories; --"
    const created = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...admin,
      payload: {
        name: injectedName,
        summary: '財物遭竊',
        steps: [{ body: '步驟密語XYZ' }, { body: '通知事主' }],
      },
    })
    expect(created.statusCode).toBe(201)
    const theftId = created.json().category.id as string
    const createdSteps = created.json().category.steps as { id: string; body: string }[]
    expect(created.json().category).toMatchObject({
      name: injectedName,
      summary: '財物遭竊',
      templateCount: 0,
    })
    expect(createdSteps.map((step) => step.body)).toEqual(['步驟密語XYZ', '通知事主'])
    expect(createQueries(db).listCategories()).toHaveLength(1)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...admin,
      payload: { name: injectedName.toLowerCase() },
    })
    expect(duplicate.statusCode).toBe(409)

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${theftId}`,
      ...admin,
      payload: {
        name: '竊盜案',
        code: 'A-01',
        summary: '',
        steps: [
          { id: createdSteps[0]?.id, body: '通知事主' },
          { id: createdSteps[1]?.id, body: '製作筆錄' },
        ],
      },
    })
    expect(renamed.statusCode).toBe(200)
    const theftSteps = renamed.json().category.steps as { id: string; body: string }[]
    expect(theftSteps.map((step) => step.body)).toEqual(['通知事主', '製作筆錄'])
    expect(theftSteps.map((step) => step.id)).toEqual(createdSteps.map((step) => step.id))
    expect(renamed.json().category).not.toHaveProperty('code')
    // Model a retained step whose stored title and body differ.
    db.prepare(
      "UPDATE category_steps SET details = json_set(details, '$.title', ?) WHERE id = ?",
    ).run('聯絡事主', theftSteps[0]?.id)

    const viewerPatch = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${theftId}`,
      ...viewer,
      payload: { name: '不行' },
    })
    expect(viewerPatch.statusCode).toBe(403)

    const damage = await app.inject({
      method: 'POST',
      url: '/api/categories',
      ...admin,
      payload: { name: '毀損案', code: 'B-02' },
    })
    expect(damage.statusCode).toBe(201)
    const damageId = damage.json().category.id as string

    const firstUpload = multipart('筆錄.docx', buildMinimalDocx('{{姓名}}'))
    const first = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: admin.cookies,
      headers: { ...firstUpload.headers, ...admin.headers },
      payload: firstUpload.payload,
    })
    expect(first.statusCode).toBe(201)
    const firstId = first.json().template.id as string
    expect(first.json().template.usages).toEqual([])

    const linkedUpload = multipart('清單.docx', buildMinimalDocx('{{物品}}'), theftSteps[0]?.id)
    const second = await app.inject({
      method: 'POST',
      url: '/api/templates',
      cookies: admin.cookies,
      headers: { ...linkedUpload.headers, ...admin.headers },
      payload: linkedUpload.payload,
    })
    expect(second.statusCode).toBe(201)
    const secondId = second.json().template.id as string
    expect(second.json().template.usages).toEqual([
      expect.objectContaining({
        categoryId: theftId,
        categoryName: '竊盜案',
        stepId: theftSteps[0]?.id,
        stepBody: '通知事主',
        stepTitle: '聯絡事主',
      }),
    ])

    const viewerLink = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${theftId}`,
      ...viewer,
      payload: {
        name: '竊盜案',
        steps: [{ id: theftSteps[0]?.id, body: '通知事主', templateIds: [firstId, secondId] }],
      },
    })
    expect(viewerLink.statusCode).toBe(403)

    const missingTemplate = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${theftId}`,
      ...admin,
      payload: {
        name: '竊盜案',
        steps: [
          { id: theftSteps[0]?.id, body: '通知事主', templateIds: [firstId, 'missing-template'] },
        ],
      },
    })
    expect(missingTemplate.statusCode).toBe(400)

    const duplicates = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${theftId}`,
      ...admin,
      payload: {
        name: '竊盜案',
        steps: [{ id: theftSteps[0]?.id, body: '通知事主', templateIds: [firstId, firstId] }],
      },
    })
    expect(duplicates.statusCode).toBe(400)

    const linked = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${theftId}`,
      ...admin,
      payload: {
        name: '竊盜案',
        code: 'A-01',
        steps: [
          { id: theftSteps[0]?.id, body: '通知事主', templateIds: [secondId, firstId] },
          { id: theftSteps[1]?.id, body: '製作筆錄', templateIds: [] },
        ],
      },
    })
    expect(linked.statusCode).toBe(200)
    expect(linked.json().category.templateCount).toBe(2)
    expect(linked.json().category.steps[0].templateIds).toEqual([secondId, firstId])

    const shared = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${damageId}`,
      ...admin,
      payload: {
        name: '毀損案',
        code: 'B-02',
        steps: [{ body: '現場紀錄', templateIds: [firstId] }],
      },
    })
    expect(shared.statusCode).toBe(200)

    const theftTemplates = await app.inject({
      method: 'GET',
      url: `/api/templates?categoryId=${theftId}`,
      cookies: { session: viewer.cookies.session },
    })
    expect(theftTemplates.statusCode).toBe(200)
    expect(theftTemplates.json().templates.map((item: { id: string }) => item.id)).toEqual([
      secondId,
      firstId,
    ])
    const sharedTemplate = theftTemplates
      .json()
      .templates.find((item: { id: string }) => item.id === firstId)
    expect(
      sharedTemplate.usages.map((item: { categoryName: string; stepBody: string }) => ({
        categoryName: item.categoryName,
        stepBody: item.stepBody,
      })),
    ).toEqual([
      { categoryName: '毀損案', stepBody: '現場紀錄' },
      { categoryName: '竊盜案', stepBody: '通知事主' },
    ])

    const clerkDeleteCategory = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${damageId}`,
      ...clerk,
    })
    expect(clerkDeleteCategory.statusCode).toBe(403)

    const removedCategory = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${damageId}`,
      ...admin,
    })
    expect(removedCategory.statusCode).toBe(204)
    const fileAfterCategoryDelete = await app.inject({
      method: 'GET',
      url: `/api/templates/${firstId}/file`,
      cookies: { session: viewer.cookies.session },
    })
    expect(fileAfterCategoryDelete.statusCode).toBe(200)
    expect(createQueries(db).getCategory(theftId)?.templateCount).toBe(2)
    expect(createQueries(db).getCategory(damageId)).toBeNull()
    const remainingLinks = db
      .prepare(
        `SELECT cs.category_id
         FROM step_templates st
         JOIN category_steps cs ON cs.id = st.step_id
         WHERE st.template_id = ?`,
      )
      .all(firstId) as { category_id: string }[]
    expect(remainingLinks.map((row) => row.category_id)).toEqual([theftId])

    const clerkDeleteTemplate = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${firstId}`,
      ...clerk,
    })
    expect(clerkDeleteTemplate.statusCode).toBe(403)

    const removedTemplate = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${firstId}`,
      ...admin,
    })
    expect(removedTemplate.statusCode).toBe(204)
    expect(createQueries(db).getTemplateFile(firstId)).toBeNull()
    expect(createQueries(db).getCategory(theftId)?.templateCount).toBe(1)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM step_templates WHERE template_id = ?').get(firstId),
    ).toEqual({ count: 0 })

    const columns = db.prepare("SELECT name FROM pragma_table_info('categories')").all() as {
      name: string
    }[]
    expect(columns.map((column) => column.name)).not.toContain('姓名')
    expect(columns.map((column) => column.name)).not.toContain('audience')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((table) => table.name)).not.toContain('case_values')

    const audit = db.prepare('SELECT action, detail, result FROM audit_log ORDER BY id').all() as {
      action: string
      detail: string
      result: string
    }[]
    const allowed = audit.filter((row) => row.result === 'allowed')
    const denied = audit.filter((row) => row.result === 'denied')
    expect(allowed.map((row) => row.action)).toEqual([
      'category_update', // Built-in field adjustment at startup.
      'category_create',
      'category_update',
      'category_create',
      'upload',
      'upload',
      'category_update',
      'category_update',
      'category_delete',
      'delete',
    ])
    expect(denied.length).toBeGreaterThan(0)
    expect(denied.every((row) => row.detail === '')).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('步驟密語XYZ')
    expect(JSON.stringify(denied)).not.toContain('不行')
    expect(JSON.stringify(allowed)).toContain('竊盜案')
  })
})
