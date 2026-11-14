<script setup lang="ts">
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { roleLabels } from '@/data/roles'
import { apiErrorMessage, apiRequest } from '@/services/api'
import { useSessionStore } from '@/stores/session'
import type { MemberAccount } from '@/types/domain'
import { formatStoredDate } from '@/utils/rocDate'
import { computed, onMounted, ref } from 'vue'

const session = useSessionStore()
const members = ref<MemberAccount[]>([])
const ready = ref(false)
const message = ref('')
const tone = ref<'ok' | 'warn'>('warn')
const pendingId = ref('')
const showForm = ref(false)
const name = ref('')
const nickname = ref('')
const username = ref('')
const password = ref('')

const activeSysadmins = computed(
  () => members.value.filter((member) => member.role === 'sysadmin' && member.active).length,
)

function isSelf(member: MemberAccount) {
  return member.id === session.user?.id
}

function canDisable(member: MemberAccount) {
  if (isSelf(member)) return false
  if (member.role === 'sysadmin' && member.active && activeSysadmins.value <= 1) return false
  return member.active
}

function canEnable(member: MemberAccount) {
  return !member.active
}

function canDemote(member: MemberAccount) {
  return member.role === 'sysadmin' && !isSelf(member)
}

async function load() {
  const response = await apiRequest('/api/members')
  if (!response.ok) {
    tone.value = 'warn'
    message.value = await apiErrorMessage(response, '無法讀取會員。')
    ready.value = true
    return false
  }
  const body = (await response.json()) as { members?: MemberAccount[] }
  members.value = body.members ?? []
  ready.value = true
  return true
}

async function patch(member: MemberAccount, payload: Record<string, unknown>, okText: string) {
  if (pendingId.value) return
  pendingId.value = member.id
  message.value = ''
  try {
    const response = await apiRequest(`/api/members/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      tone.value = 'warn'
      message.value = await apiErrorMessage(response, '無法更新這位會員。')
      return
    }
    const loaded = await load()
    if (!loaded) return
    tone.value = 'ok'
    message.value = okText
  } finally {
    pendingId.value = ''
  }
}

async function deleteMember(member: MemberAccount) {
  if (pendingId.value || isSelf(member)) return
  if (!window.confirm(`確定完全刪除「${member.username}」？`)) return
  if (!window.confirm('再次確認：帳號、登入階段與該會員留言將永久刪除，無法復原。')) return
  pendingId.value = member.id
  try {
    const response = await apiRequest(`/api/members/${encodeURIComponent(member.id)}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(await apiErrorMessage(response, '無法刪除會員。'))
    await load()
    tone.value = 'ok'
    message.value = '已完全刪除會員。'
  } catch (cause) {
    tone.value = 'warn'
    message.value = cause instanceof Error ? cause.message : '無法刪除會員。'
  } finally {
    pendingId.value = ''
  }
}

async function createMember() {
  if (pendingId.value) return
  message.value = ''
  if (password.value.length < 12) {
    tone.value = 'warn'
    message.value = '密碼至少需要 12 個字元。'
    return
  }
  pendingId.value = 'new'
  try {
    const response = await apiRequest('/api/members', {
      method: 'POST',
      body: JSON.stringify({
        name: name.value.trim(),
        nickname: nickname.value.trim(),
        username: username.value.trim(),
        password: password.value,
      }),
    })
    if (!response.ok) {
      tone.value = 'warn'
      message.value = await apiErrorMessage(response, '無法新增會員。')
      return
    }
    name.value = ''
    nickname.value = ''
    username.value = ''
    password.value = ''
    showForm.value = false
    tone.value = 'ok'
    message.value = '已新增會員。'
    await load()
  } finally {
    pendingId.value = ''
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <PageIntro
    eyebrow="管理"
    title="會員管理"
    description="系統管理員可以新增會員、啟用或停用帳號，並決定誰可以維護案件範本。停用後，該帳號的登入階段會立即失效。"
  >
    <button type="button" class="btn-primary" @click="showForm = !showForm">新增會員</button>
  </PageIntro>

  <p
    v-if="message"
    class="mb-6 rounded-control px-3 py-2 text-sm leading-6"
    :class="tone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'"
    role="status"
  >
    {{ message }}
  </p>

  <form
    v-if="showForm"
    class="mb-6 grid gap-4 rounded-2xl border border-edge bg-surface p-5 shadow-card sm:grid-cols-2"
    @submit.prevent="createMember"
  >
    <div>
      <label for="member-name" class="block text-sm font-medium text-stone-800">名稱</label>
      <input id="member-name" v-model="name" required maxlength="40" class="field mt-2 w-full" />
    </div>
    <div>
      <label for="member-nickname" class="block text-sm font-medium text-stone-800">暱稱</label>
      <input
        id="member-nickname"
        v-model="nickname"
        required
        maxlength="40"
        class="field mt-2 w-full"
      />
    </div>
    <div>
      <label for="member-username" class="block text-sm font-medium text-stone-800">帳號</label>
      <input
        id="member-username"
        v-model="username"
        required
        minlength="3"
        maxlength="32"
        pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
        class="field mt-2 w-full"
      />
    </div>
    <div>
      <label for="member-password" class="block text-sm font-medium text-stone-800">初始密碼</label>
      <input
        id="member-password"
        v-model="password"
        type="password"
        required
        minlength="12"
        autocomplete="new-password"
        class="field mt-2 w-full"
      />
    </div>
    <div class="sm:col-span-2">
      <button type="submit" class="btn-primary" :disabled="pendingId === 'new'">建立帳號</button>
    </div>
  </form>

  <p v-if="!ready" class="text-sm text-ink-muted">正在讀取會員。</p>

  <section v-else class="overflow-hidden rounded-2xl border border-edge bg-surface shadow-card">
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <caption class="sr-only">
          會員名單
        </caption>
        <thead class="bg-surface-muted text-xs text-ink-muted">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">名稱</th>
            <th scope="col" class="px-4 py-3 font-medium">暱稱</th>
            <th scope="col" class="px-4 py-3 font-medium">帳號</th>
            <th scope="col" class="px-4 py-3 font-medium">角色</th>
            <th scope="col" class="px-4 py-3 font-medium">狀態</th>
            <th scope="col" class="px-4 py-3 font-medium">可維護流程</th>
            <th scope="col" class="px-4 py-3 font-medium">註冊時間</th>
            <th scope="col" class="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-stone-200">
          <tr v-for="member in members" :key="member.id">
            <td class="px-4 py-3 font-medium text-ink">{{ member.displayName }}</td>
            <td class="px-4 py-3 text-stone-700">{{ member.nickname }}</td>
            <td class="px-4 py-3 text-stone-700">{{ member.username }}</td>
            <td class="px-4 py-3 text-stone-700">{{ roleLabels[member.role] }}</td>
            <td class="px-4 py-3">
              <StatusBadge
                :label="member.active ? '啟用' : '停用'"
                :tone="member.active ? 'ok' : 'danger'"
              />
            </td>
            <td class="px-4 py-3 text-stone-700">{{ member.canManageCategories ? '可' : '否' }}</td>
            <td class="px-4 py-3 whitespace-nowrap text-stone-600 tabular-nums">
              {{ formatStoredDate(member.createdAt) }}
            </td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-2">
                <button
                  v-if="!isSelf(member)"
                  type="button"
                  :disabled="Boolean(pendingId)"
                  class="focus-control rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-tone-danger-ink"
                  @click="deleteMember(member)"
                >
                  完全刪除
                </button>
                <button
                  v-if="canEnable(member)"
                  type="button"
                  class="focus-control rounded-lg border border-edge px-2.5 py-1 text-xs text-stone-800 hover:bg-surface-muted disabled:text-ink-subtle"
                  :disabled="pendingId === member.id"
                  @click="patch(member, { active: true }, '已啟用帳號。')"
                >
                  啟用
                </button>
                <button
                  v-else
                  type="button"
                  class="focus-control rounded-lg border border-edge px-2.5 py-1 text-xs text-stone-800 hover:bg-surface-muted disabled:text-ink-subtle"
                  :disabled="!canDisable(member) || pendingId === member.id"
                  @click="patch(member, { active: false }, '已停用帳號。')"
                >
                  停用
                </button>
                <button
                  type="button"
                  class="focus-control rounded-lg border border-edge px-2.5 py-1 text-xs text-stone-800 hover:bg-surface-muted disabled:text-ink-subtle"
                  :disabled="pendingId === member.id"
                  @click="
                    patch(
                      member,
                      { canManageCategories: !member.canManageCategories },
                      member.canManageCategories ? '已取消維護流程。' : '已開放維護流程。',
                    )
                  "
                >
                  {{ member.canManageCategories ? '取消維護流程' : '可維護流程' }}
                </button>
                <button
                  v-if="member.role === 'sysadmin'"
                  type="button"
                  class="focus-control rounded-lg border border-edge px-2.5 py-1 text-xs text-stone-800 hover:bg-surface-muted disabled:text-ink-subtle"
                  :disabled="!canDemote(member) || pendingId === member.id"
                  @click="patch(member, { role: 'user' }, '已取消系統管理員。')"
                >
                  取消系統管理員
                </button>
                <button
                  v-else
                  type="button"
                  class="focus-control rounded-lg border border-edge px-2.5 py-1 text-xs text-stone-800 hover:bg-surface-muted disabled:text-ink-subtle"
                  :disabled="pendingId === member.id"
                  @click="patch(member, { role: 'sysadmin' }, '已設為系統管理員。')"
                >
                  設為系統管理員
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
