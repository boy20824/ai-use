import type { AccessRole, CaseRecord, PersonnelRecord } from '@/types/records'

export const caseRecords: CaseRecord[] = [
  {
    id: 'C-2026-014',
    title: '研發部門申請使用程式輔助模型',
    applicant: '林可恩',
    department: '研發處',
    status: '審核中',
    updatedAt: '2026-10-27',
  },
  {
    id: 'C-2026-011',
    title: '客服知識庫摘要試辦',
    applicant: '陳品妍',
    department: '客戶服務部',
    status: '已核准',
    updatedAt: '2026-10-21',
  },
  {
    id: 'C-2026-009',
    title: '法遵文件比對工具評估',
    applicant: '黃柏宇',
    department: '法務室',
    status: '已退回',
    updatedAt: '2026-10-18',
  },
  {
    id: 'C-2026-006',
    title: '教育訓練教材草稿輔助',
    applicant: '張書瑋',
    department: '人資處',
    status: '草稿',
    updatedAt: '2026-10-12',
  },
]

export const personnelRecords: PersonnelRecord[] = [
  {
    id: 'P-1008',
    name: '林可恩',
    department: '研發處',
    title: '資深工程師',
    status: '在職',
  },
  {
    id: 'P-1014',
    name: '陳品妍',
    department: '客戶服務部',
    title: '客服專員',
    status: '在職',
  },
  {
    id: 'P-0982',
    name: '黃柏宇',
    department: '法務室',
    title: '法務專員',
    status: '在職',
  },
  {
    id: 'P-1102',
    name: '張書瑋',
    department: '人資處',
    title: '訓練規劃',
    status: '留停',
  },
]

export const accessRoles: AccessRole[] = [
  {
    id: 'R-ADMIN',
    name: '系統管理員',
    members: 2,
    scope: '維護系統設定與檢視稽核紀錄',
  },
  {
    id: 'R-CASE',
    name: '案件承辦',
    members: 6,
    scope: '建立案件並更新處理進度',
  },
  {
    id: 'R-REVIEW',
    name: '權限審核',
    members: 3,
    scope: '審核人員的存取申請',
  },
  {
    id: 'R-READ',
    name: '唯讀檢視',
    members: 11,
    scope: '檢視報表與既有紀錄',
  },
]
