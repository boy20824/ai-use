import { zipGeneratedFiles } from '@/services/docxTemplates'
import { applyRocDateFields } from '@/utils/rocDate'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  checkedTemplates,
  dedupedIds,
  inputFields,
  overviewCatalog,
  overviewDownloadName,
  valuesForFields,
  type OverviewTemplate,
} from './overview'

const categoryName = '竊盜'

const library: OverviewTemplate[] = [
  { id: 'tpl-record', fileName: '筆錄.docx', placeholders: ['姓名', '日期', '案號'] },
  { id: 'tpl-list', fileName: '清單.docx', placeholders: ['姓名', '物品'] },
  { id: 'tpl-notice', fileName: '通知.docx', placeholders: ['案號', '日期_民國'] },
  { id: 'tpl-search', fileName: '搜索.docx', placeholders: ['姓名', '地點'] },
]

function lookup(id: string) {
  return library.find((item) => item.id === id)
}

describe('全部文件總覽', () => {
  it('竊盜取消一份並暫加一份後，壓縮檔正好三份，共用欄位只出現一次', async () => {
    const steps = [
      { templateIds: ['tpl-record', 'tpl-list'] },
      { templateIds: ['tpl-notice', 'tpl-record'] },
    ]
    const categoryIds = dedupedIds(steps)
    expect(categoryName).toBe('竊盜')
    expect(categoryIds).toEqual(['tpl-record', 'tpl-list', 'tpl-notice'])

    const temporaryIds = ['tpl-search']
    const catalog = overviewCatalog(categoryIds, temporaryIds, lookup)
    expect(catalog.map((item) => item.id)).toEqual([
      'tpl-record',
      'tpl-list',
      'tpl-notice',
      'tpl-search',
    ])

    const selected = checkedTemplates(catalog, { 'tpl-list': true })
    expect(selected.map((item) => item.fileName)).toEqual(['筆錄.docx', '通知.docx', '搜索.docx'])

    const fields = inputFields(selected)
    expect(fields).toEqual(['姓名', '日期', '案號', '地點'])
    expect(new Set(fields).size).toBe(fields.length)
    expect(fields.filter((field) => field === '姓名')).toEqual(['姓名'])
    expect(fields).not.toContain('日期_民國')
    expect(fields).not.toContain('物品')

    const filled = applyRocDateFields(
      valuesForFields({ 姓名: '王小明', 日期: '115/10/29', 案號: 'A1', 地點: '公園' }, fields),
    )
    expect(filled).toEqual({
      姓名: '王小明',
      日期: '115年10月29日',
      案號: 'A1',
      地點: '公園',
      日期_民國: '115/10/29',
    })

    const zip = await zipGeneratedFiles(
      selected.map((item) => ({
        name: overviewDownloadName(item.fileName),
        data: new TextEncoder().encode('王小明'),
      })),
    )
    const packed = await JSZip.loadAsync(await zip.arrayBuffer())
    const names = Object.keys(packed.files).filter((name) => packed.files[name]?.dir !== true)
    expect(names).toHaveLength(3)
    expect(names.sort()).toEqual(
      ['筆錄.docx', '通知.docx', '搜索.docx'].map((name) => overviewDownloadName(name)).sort(),
    )
    expect(steps.flatMap((step) => step.templateIds)).not.toContain('tpl-search')
    expect(categoryIds).toEqual(['tpl-record', 'tpl-list', 'tpl-notice'])
  })

  it('預設勾選類別內去重後的全部範本，相同欄位只問一次', () => {
    const steps = [
      { templateIds: ['tpl-record', 'tpl-list'] },
      { templateIds: ['tpl-notice', 'tpl-record'] },
    ]
    const catalog = overviewCatalog(dedupedIds(steps), [], lookup)
    const selected = checkedTemplates(catalog, {})
    expect(selected).toHaveLength(3)
    const fields = inputFields(selected)
    expect(fields).toEqual(['姓名', '日期', '案號', '物品'])
    expect(new Set(fields).size).toBe(fields.length)
  })
})
