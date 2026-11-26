import { ref } from 'vue'

export const editPermissionHint = '需要修改步驟或範本？請洽系統管理員開通「可維護流程」權限。'
export const categoryEditDenied = ref(false)
export const createdCategoryNotice = ref<{ id: string; name: string } | null>(null)
