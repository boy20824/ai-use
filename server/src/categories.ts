export interface CategoryRecord {
  id: string
  code: string
  name: string
  summary: string
  audience: string
  updatedAt: string
}

export const categories: CategoryRecord[] = [
  {
    id: 'general-assist',
    code: 'CAT-01',
    name: '一般業務輔助',
    summary: '整理日常備忘、用語與內部說明的草稿。適合已經可以在單位內傳閱的一般文字。',
    audience: '各單位承辦',
    updatedAt: '2026-10-16',
  },
  {
    id: 'doc-summary',
    code: 'CAT-02',
    name: '文件摘要整理',
    summary: '把會議紀錄、規章或長篇說明收成重點、待辦與名詞對照。原文仍以原檔為準。',
    audience: '需要整理長文的承辦',
    updatedAt: '2026-10-18',
  },
  {
    id: 'training-material',
    code: 'CAT-03',
    name: '教育訓練教材',
    summary: '把既有教材改寫成課程大綱、講稿提要或練習題草稿。上課前仍須人工覆核。',
    audience: '訓練規劃',
    updatedAt: '2026-10-12',
  },
  {
    id: 'public-copy',
    code: 'CAT-04',
    name: '對外內容準備',
    summary: '整理公告、常見問答或活動文案的草稿。此頁只幫助準備，不負責發布。',
    audience: '準備公告或問答的承辦',
    updatedAt: '2026-10-25',
  },
  {
    id: 'analysis-pilot',
    code: 'CAT-05',
    name: '資料分析試辦',
    summary: '針對無法識別個人的彙總統計，試寫趨勢說明與圖表標題草稿。',
    audience: '已持有彙總統計的承辦',
    updatedAt: '2026-10-09',
  },
]

export const categoryIds = new Set(categories.map((item) => item.id))
