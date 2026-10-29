import type {
  AccessRole,
  AppRole,
  CaseCategory,
  PermissionKey,
  PermissionRow,
} from '@/types/domain'

export const roleLabels: Record<AppRole, string> = {
  admin: '系統管理員',
  clerk: '類別承辦',
  viewer: '唯讀檢視',
}

export const roleOrder: AppRole[] = ['viewer', 'clerk', 'admin']

export const permissionRows: PermissionRow[] = [
  {
    key: 'browse',
    label: '瀏覽類別、文件與步驟',
    roles: ['viewer', 'clerk', 'admin'],
  },
  {
    key: 'upload',
    label: '上傳範本文件',
    roles: ['clerk', 'admin'],
  },
  {
    key: 'remove',
    label: '移除範本文件',
    roles: ['admin'],
  },
  {
    key: 'access',
    label: '檢視角色與權限對照',
    roles: ['viewer', 'clerk', 'admin'],
  },
]

const roleSummaries: Record<AppRole, string> = {
  viewer: '可閱讀類別、文件與範本，也能在本機產生文件，但不能上傳或移除範本。',
  clerk: '可上傳範本文件，並在本機填入欄位後下載。不能移除範本。',
  admin: '可上傳與移除範本，並可對照角色權限。此頁不會變更真實授權。',
}

const roleMembers: Record<AppRole, number> = {
  viewer: 5,
  clerk: 8,
  admin: 2,
}

export function roleAllows(role: AppRole, key: PermissionKey): boolean {
  const row = permissionRows.find((item) => item.key === key)
  return row ? row.roles.includes(role) : false
}

export function permissionsFor(role: AppRole): string[] {
  return permissionRows.filter((row) => row.roles.includes(role)).map((row) => row.label)
}

export const accessRoles: AccessRole[] = roleOrder.map((id) => ({
  id,
  name: roleLabels[id],
  summary: roleSummaries[id],
  members: roleMembers[id],
  permissions: permissionsFor(id),
}))

export const caseCategories: CaseCategory[] = [
  {
    id: 'general-assist',
    code: 'CAT-01',
    name: '一般業務輔助',
    summary: '整理日常備忘、用語與內部說明的草稿。適合已經可以在單位內傳閱的一般文字。',
    audience: '各單位承辦',
    updatedAt: '2026-10-16',
    caution: '檔名與內容請勿放入個資、密碼、權杖或未公開的識別資料。',
    documents: [
      {
        id: 'general-scope',
        title: '適用範圍說明',
        kind: '說明',
        summary: '這一類可以處理哪些文字，以及哪些內容不應出現在草稿。',
        updatedAt: '2026-10-02',
        points: [
          '可處理已在單位內傳閱的備忘、會議要點與用語整理。',
          '不要放入身分證件號、病歷、帳戶或未公開個資。',
          '產出只是草稿，仍由承辦人改寫後自行使用。',
        ],
      },
      {
        id: 'general-fields',
        title: '欄位填寫對照',
        kind: '表單',
        summary: '草稿檔建議包含的三個欄位，方便之後銜接正式流程。',
        updatedAt: '2026-10-08',
        points: [
          '使用目的：這次要協助完成的工作。',
          '資料來源：內容來自哪一份既有文件或會議。',
          '保管單位：草稿完成後由哪個單位留存。',
        ],
      },
      {
        id: 'general-check',
        title: '上傳前檢核',
        kind: '檢核',
        summary: '選擇檔案前自行確認，避免草稿裡出現不該流傳的內容。',
        updatedAt: '2026-10-16',
        points: [
          '檔名能看出類別與用途，不含個人姓名。',
          '內文沒有密碼、權杖或連線字串。',
          '已標明這是草稿，尚未送審。',
        ],
      },
    ],
    steps: [
      {
        id: 'general-1',
        title: '確認是一般業務',
        detail:
          '若只是整理內部備忘或改寫已可傳閱的說明，就留在這一類。對外文案與統計請改走其他類別。',
      },
      {
        id: 'general-2',
        title: '核對資料能不能用',
        detail: '閱讀適用範圍說明，確認資料已在單位內流通，且不含個資、密碼或未公開識別資料。',
      },
      {
        id: 'general-3',
        title: '依對照寫好欄位',
        detail: '在草稿中寫下使用目的、資料來源與保管單位。這三項是這一類的主體。',
      },
      {
        id: 'general-4',
        title: '上傳範本文件',
        detail:
          '把含有 {{姓名}}、{{日期}} 這類欄位的 .docx 範本上傳到此類別。範本會留在這個瀏覽器，不會送到伺服器。',
      },
      {
        id: 'general-5',
        title: '產生文件',
        detail: '在產生文件填入欄位後下載。填入的內容不會被保存。送審與結案尚未開放。',
      },
    ],
  },
  {
    id: 'doc-summary',
    code: 'CAT-02',
    name: '文件摘要整理',
    summary: '把會議紀錄、規章或長篇說明收成重點、待辦與名詞對照。原文仍以原檔為準。',
    audience: '需要整理長文的承辦',
    updatedAt: '2026-10-18',
    caution: '摘要不能取代原文。請勿上傳含有個資的簽到表或逐字稿。',
    documents: [
      {
        id: 'summary-scope',
        title: '摘要範圍說明',
        kind: '說明',
        summary: '說明摘要草稿要保留什麼，以及什麼應該留在原檔。',
        updatedAt: '2026-10-04',
        points: [
          '保留決議、待辦、期限與尚未決定的事項。',
          '人名與聯絡方式改以單位或角色稱呼。',
          '原檔頁碼或章節可註記，方便回查。',
        ],
      },
      {
        id: 'summary-fields',
        title: '摘要欄位對照',
        kind: '表單',
        summary: '一份摘要草稿建議分成背景、重點與待確認三節。',
        updatedAt: '2026-10-11',
        points: [
          '背景：這份文件是什麼，涵蓋哪一段期間。',
          '重點：三到七條即可，避免整段複製。',
          '待確認：原文沒有寫清楚、不應自行補完的部分。',
        ],
      },
      {
        id: 'summary-check',
        title: '摘要檢核清單',
        kind: '檢核',
        summary: '上傳前確認摘要沒有把推測寫成事實。',
        updatedAt: '2026-10-18',
        points: [
          '每一條重點都能在原文找到對應位置。',
          '沒有自行新增原文沒有的數字或承諾。',
          '檔名標示「摘要草稿」。',
        ],
      },
    ],
    steps: [
      {
        id: 'summary-1',
        title: '確認原文可以摘要',
        detail: '只處理已可在單位內閱讀的會議紀錄、規章或說明。含個資的簽到與逐字稿不在此類。',
      },
      {
        id: 'summary-2',
        title: '標出要留下的結構',
        detail: '先決定背景、重點與待確認三節，再閱讀摘要範圍說明。',
      },
      {
        id: 'summary-3',
        title: '依欄位寫成草稿',
        detail: '重點控制在三到七條，並註記可回查的章節或頁碼。推測不要寫成事實。',
      },
      {
        id: 'summary-4',
        title: '上傳摘要範本',
        detail: '上傳這一類的 .docx 範本，並用 {{欄位名}} 標出要帶入的位置。範本會留在這個瀏覽器。',
      },
      {
        id: 'summary-5',
        title: '產生文件',
        detail: '填入欄位後下載套好的文件。填入內容只存在這個畫面，離開後即清除。',
      },
    ],
  },
  {
    id: 'training-material',
    code: 'CAT-03',
    name: '教育訓練教材',
    summary: '把既有教材改寫成課程大綱、講稿提要或練習題草稿。上課前仍須人工覆核。',
    audience: '訓練規劃',
    updatedAt: '2026-10-12',
    caution: '練習題不要嵌入真實學員姓名、成績或證照號碼。',
    documents: [
      {
        id: 'training-scope',
        title: '教材使用說明',
        kind: '說明',
        summary: '這一類協助改寫大綱與練習，不取代講師審定。',
        updatedAt: '2026-09-28',
        points: [
          '來源應是既有教材、講義或已核定的課程目標。',
          '練習題使用虛構情境，不使用真實學員資料。',
          '草稿須再經講師或單位覆核後才能上課。',
        ],
      },
      {
        id: 'training-fields',
        title: '大綱欄位對照',
        kind: '表單',
        summary: '一份教材草稿建議標出對象、時數、單元與練習。',
        updatedAt: '2026-10-06',
        points: [
          '對象：哪個角色要上課，不寫個人姓名。',
          '單元：每個單元一個學習目標。',
          '練習：題目、參考答與需要講師確認的地方。',
        ],
      },
      {
        id: 'training-check',
        title: '教材檢核清單',
        kind: '檢核',
        summary: '上傳前確認草稿仍標示為未審定教材。',
        updatedAt: '2026-10-12',
        points: [
          '沒有真實成績、證照號或學員名單。',
          '時數與單元數和課程目標一致。',
          '封面或檔名含有「教材草稿」。',
        ],
      },
    ],
    steps: [
      {
        id: 'training-1',
        title: '確認課程已有底稿',
        detail: '這一類用來改寫既有教材，不是從空白開始編一套正式課程。',
      },
      {
        id: 'training-2',
        title: '閱讀教材使用說明',
        detail: '確認練習題會用虛構情境，且上課前仍由講師覆核。',
      },
      {
        id: 'training-3',
        title: '依欄位整理大綱',
        detail: '寫下對象、時數、各單元目標與練習。對象用角色稱呼，不寫姓名。',
      },
      {
        id: 'training-4',
        title: '上傳教材範本',
        detail: '上傳 .docx 範本。練習用的欄位用 {{名稱}} 標示，不要寫入真實學員資料。',
      },
      {
        id: 'training-5',
        title: '產生文件',
        detail: '下載前仍須人工覆核。填入的欄位不會被保存，此階段也沒有排課或結案。',
      },
    ],
  },
  {
    id: 'public-copy',
    code: 'CAT-04',
    name: '對外內容準備',
    summary: '整理公告、常見問答或活動文案的草稿。此頁只幫助準備，不負責發布。',
    audience: '準備公告或問答的承辦',
    updatedAt: '2026-10-25',
    caution: '尚未定稿的數字、日期與承諾不要寫成已核定事實。',
    documents: [
      {
        id: 'public-scope',
        title: '對外草稿說明',
        kind: '說明',
        summary: '說明這一類產出的是準備稿，發布仍走原有程序。',
        updatedAt: '2026-10-09',
        points: [
          '可準備公告標題、問答與活動說明的草稿。',
          '不在此頁發布、寄送或對外匯出。',
          '引用的日期與數字需註明是否仍待確認。',
        ],
      },
      {
        id: 'public-fields',
        title: '文案欄位對照',
        kind: '表單',
        summary: '一份對外草稿建議分開讀者、要說的事與待核定句。',
        updatedAt: '2026-10-19',
        points: [
          '讀者：公告要給誰看，用群體稱呼。',
          '訊息：希望對方知道或要做的事。',
          '待核定：還不能當成事實的數字、日期與承諾。',
        ],
      },
      {
        id: 'public-check',
        title: '發布前檢核',
        kind: '檢核',
        summary: '即使只是草稿，也先排除不該對外的句子。',
        updatedAt: '2026-10-25',
        points: [
          '沒有內部討論、個資或未公開決定。',
          '待核定的句子已明確標出。',
          '檔名含有「未發布草稿」。',
        ],
      },
    ],
    steps: [
      {
        id: 'public-1',
        title: '確認只是準備稿',
        detail: '這一類用來整理公告、問答或活動文案。發布與寄送不在此頁進行。',
      },
      {
        id: 'public-2',
        title: '分開已定與未定',
        detail: '閱讀對外草稿說明，把尚未核定的數字、日期與承諾單獨列出。',
      },
      {
        id: 'public-3',
        title: '依欄位寫文案',
        detail: '寫下讀者、要傳達的事，以及待核定句。讀者用群體稱呼。',
      },
      {
        id: 'public-4',
        title: '上傳文案範本',
        detail: '上傳尚未發布的 .docx 範本。範本留在這個瀏覽器，不會被送到伺服器或對外發布。',
      },
      {
        id: 'public-5',
        title: '產生文件',
        detail: '填入欄位後下載即可。後續發布仍走原有程序，此階段沒有送審。',
      },
    ],
  },
  {
    id: 'analysis-pilot',
    code: 'CAT-05',
    name: '資料分析試辦',
    summary: '針對無法識別個人的彙總統計，試寫趨勢說明與圖表標題草稿。',
    audience: '已持有彙總統計的承辦',
    updatedAt: '2026-10-09',
    caution: '不接受明細名單、可識別編號或尚未彙總的原始匯出檔。',
    documents: [
      {
        id: 'analysis-scope',
        title: '試辦範圍說明',
        kind: '說明',
        summary: '只接受已經彙總、無法還原到個人的數字。',
        updatedAt: '2026-09-30',
        points: [
          '可以使用合計、比例與區間這類彙總結果。',
          '不接受明細、帳號、證號或可識別編號。',
          '說明草稿要標出統計期間與口徑。',
        ],
      },
      {
        id: 'analysis-fields',
        title: '說明欄位對照',
        kind: '表單',
        summary: '趨勢說明建議包含期間、口徑、觀察與限制。',
        updatedAt: '2026-10-05',
        points: [
          '期間：數字涵蓋的起迄。',
          '口徑：誰被計入、什麼被排除。',
          '限制：樣本太小或不應解讀的部分。',
        ],
      },
      {
        id: 'analysis-check',
        title: '匯入前檢核',
        kind: '檢核',
        summary: '選擇檔案前確認裡面沒有明細資料。',
        updatedAt: '2026-10-09',
        points: [
          '表格每一列都是彙總，不是一筆個人紀錄。',
          '沒有姓名、地址、聯絡方式或證件號。',
          '檔名標示期間與「分析草稿」。',
        ],
      },
    ],
    steps: [
      {
        id: 'analysis-1',
        title: '確認手邊是彙總表',
        detail: '若檔案仍是明細或原始匯出，請先在原系統彙總，不要把明細放到這一類。',
      },
      {
        id: 'analysis-2',
        title: '閱讀試辦範圍',
        detail: '核對數字無法識別個人，並準備寫出統計期間與口徑。',
      },
      {
        id: 'analysis-3',
        title: '撰寫趨勢說明',
        detail: '依欄位寫下期間、口徑、觀察與限制。樣本太小時不要下結論。',
      },
      {
        id: 'analysis-4',
        title: '上傳說明範本',
        detail: '上傳只含彙總說明的 .docx 範本。範本留在這個瀏覽器，不會把檔案送到伺服器。',
      },
      {
        id: 'analysis-5',
        title: '產生文件',
        detail: '填入欄位後下載。分析報告的核定流程尚未開放，填入內容也不會被保存。',
      },
    ],
  },
]
