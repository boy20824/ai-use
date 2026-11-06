<script setup lang="ts">
import FeedbackText from '@/components/FeedbackText.vue'
import PageIntro from '@/components/PageIntro.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { apiErrorMessage, apiRequest } from '@/services/api'
import { useSessionStore } from '@/stores/session'
import type { FeedbackPost, FeedbackStatus } from '@/types/domain'
import { formatStoredDate } from '@/utils/rocDate'
import { feedbackStatusLabel, feedbackStatusTone } from '@/utils/status'
import { computed, onMounted, ref } from 'vue'

const session = useSessionStore()
const posts = ref<FeedbackPost[]>([])
const ready = ref(false)
const message = ref('')
const tone = ref<'ok' | 'warn'>('warn')
const filter = ref<FeedbackStatus | ''>('')
const title = ref('')
const content = ref('')
const editingId = ref('')
const editTitle = ref('')
const editContent = ref('')
const replyDrafts = ref<Record<string, string>>({})
const pendingId = ref('')

const filters: { value: FeedbackStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待處理' },
  { value: 'in_progress', label: '處理中' },
  { value: 'done', label: '已完成' },
]

const remaining = computed(() => 2000 - content.value.length)

function owns(post: FeedbackPost) {
  return post.authorId === session.user?.id
}

async function load() {
  const query = filter.value ? `?status=${filter.value}` : ''
  const response = await apiRequest(`/api/feedback${query}`)
  if (!response.ok) {
    tone.value = 'warn'
    message.value = await apiErrorMessage(response, '無法讀取留言。')
    ready.value = true
    return
  }
  const body = (await response.json()) as { posts?: FeedbackPost[] }
  posts.value = body.posts ?? []
  for (const post of posts.value) {
    if (replyDrafts.value[post.id] === undefined) replyDrafts.value[post.id] = post.adminReply
  }
  ready.value = true
}

async function createPost() {
  message.value = ''
  if (content.value.trim().length > 2000) {
    tone.value = 'warn'
    message.value = '內容最多 2000 個字。'
    return
  }
  pendingId.value = 'new'
  try {
    const response = await apiRequest('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ title: title.value.trim(), content: content.value.trim() }),
    })
    if (!response.ok) {
      tone.value = 'warn'
      message.value = await apiErrorMessage(response, '無法送出留言。')
      return
    }
    title.value = ''
    content.value = ''
    tone.value = 'ok'
    message.value = '已送出建議。'
    await load()
  } finally {
    pendingId.value = ''
  }
}

function startEdit(post: FeedbackPost) {
  editingId.value = post.id
  editTitle.value = post.title
  editContent.value = post.content
}

async function saveEdit(post: FeedbackPost) {
  pendingId.value = post.id
  message.value = ''
  try {
    const response = await apiRequest(`/api/feedback/${post.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: editTitle.value.trim(), content: editContent.value.trim() }),
    })
    if (!response.ok) {
      tone.value = 'warn'
      message.value = await apiErrorMessage(response, '無法修改留言。')
      return
    }
    editingId.value = ''
    tone.value = 'ok'
    message.value = '已更新留言。'
    await load()
  } finally {
    pendingId.value = ''
  }
}

async function remove(post: FeedbackPost) {
  pendingId.value = post.id
  message.value = ''
  try {
    const response = await apiRequest(`/api/feedback/${post.id}`, { method: 'DELETE' })
    if (!response.ok) {
      tone.value = 'warn'
      message.value = await apiErrorMessage(response, '無法刪除留言。')
      return
    }
    tone.value = 'ok'
    message.value = '已刪除留言。'
    await load()
  } finally {
    pendingId.value = ''
  }
}

async function moderate(post: FeedbackPost, status: FeedbackStatus) {
  pendingId.value = post.id
  message.value = ''
  try {
    const response = await apiRequest(`/api/feedback/${post.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        adminReply: replyDrafts.value[post.id] ?? '',
      }),
    })
    if (!response.ok) {
      tone.value = 'warn'
      message.value = await apiErrorMessage(response, '無法更新處理狀態。')
      return
    }
    tone.value = 'ok'
    message.value = '已更新處理狀態。'
    await load()
  } finally {
    pendingId.value = ''
  }
}

function onStatus(post: FeedbackPost, event: Event) {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : ''
  if (value === 'pending' || value === 'in_progress' || value === 'done') {
    void moderate(post, value)
  }
}

function chooseFilter(value: FeedbackStatus | '') {
  filter.value = value
  void load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <PageIntro
    eyebrow="留言板"
    title="網頁改善建議"
    description="登入後可以提出建議，也可以修改或刪除自己的留言。處理狀態與管理員回覆由系統管理員更新。內容以純文字顯示。"
  />

  <div class="mb-6 flex flex-wrap gap-2" role="group" aria-label="依狀態篩選">
    <button
      v-for="item in filters"
      :key="item.label"
      type="button"
      class="focus-control rounded-full px-3 py-1.5 text-sm"
      :class="
        filter === item.value
          ? 'bg-ink text-white'
          : 'bg-surface text-stone-700 ring-1 ring-stone-200 hover:bg-surface-muted'
      "
      :aria-pressed="filter === item.value"
      @click="chooseFilter(item.value)"
    >
      {{ item.label }}
    </button>
  </div>

  <p
    v-if="message"
    class="mb-6 rounded-control px-3 py-2 text-sm leading-6"
    :class="tone === 'ok' ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'"
    role="status"
  >
    {{ message }}
  </p>

  <form
    class="mb-8 rounded-2xl border border-edge bg-surface p-5 shadow-card"
    @submit.prevent="createPost"
  >
    <h2 class="text-base font-semibold text-ink-strong">提出建議</h2>
    <div class="mt-4">
      <label for="feedback-title" class="block text-sm font-medium text-stone-800">標題</label>
      <input
        id="feedback-title"
        v-model="title"
        required
        maxlength="80"
        class="field mt-2 w-full"
      />
    </div>
    <div class="mt-4">
      <label for="feedback-content" class="block text-sm font-medium text-stone-800">內容</label>
      <textarea
        id="feedback-content"
        v-model="content"
        required
        maxlength="2000"
        rows="5"
        class="field mt-2 w-full"
      ></textarea>
      <p class="mt-2 text-xs text-ink-muted">還可輸入 {{ remaining }} 個字。</p>
    </div>
    <button type="submit" class="btn-primary mt-4" :disabled="pendingId === 'new'">送出</button>
  </form>

  <p v-if="!ready" class="text-sm text-ink-muted">正在讀取留言。</p>
  <p v-else-if="posts.length === 0" class="text-sm text-ink-muted">這個狀態目前沒有留言。</p>

  <section v-else class="space-y-4" aria-label="建議列表">
    <article
      v-for="post in posts"
      :key="post.id"
      class="rounded-2xl border border-edge bg-surface p-5 shadow-card"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h2 class="text-base font-semibold text-ink-strong">
          <FeedbackText :text="post.title" />
        </h2>
        <StatusBadge
          :label="feedbackStatusLabel(post.status)"
          :tone="feedbackStatusTone(post.status)"
        />
      </div>
      <p class="mt-2 text-xs leading-5 text-ink-muted">
        {{ post.authorNickname }} · {{ formatStoredDate(post.createdAt) }}
        <span v-if="post.updatedAt !== post.createdAt">
          · 更新 {{ formatStoredDate(post.updatedAt) }}
        </span>
      </p>

      <form v-if="editingId === post.id" class="mt-4 space-y-3" @submit.prevent="saveEdit(post)">
        <input v-model="editTitle" required maxlength="80" aria-label="標題" class="field w-full" />
        <textarea
          v-model="editContent"
          required
          maxlength="2000"
          rows="5"
          aria-label="內容"
          class="field w-full"
        ></textarea>
        <div class="flex gap-2">
          <button type="submit" class="btn-primary px-3 py-2">儲存</button>
          <button type="button" class="btn-secondary px-3 py-2" @click="editingId = ''">
            取消
          </button>
        </div>
      </form>
      <div v-else class="mt-4 text-sm leading-7 text-stone-800">
        <FeedbackText :text="post.content" />
      </div>

      <div v-if="post.adminReply" class="mt-4 rounded-control bg-surface-muted px-4 py-3">
        <p class="text-xs font-medium text-ink-muted">管理員回覆</p>
        <div class="mt-2 text-sm leading-7 text-stone-800">
          <FeedbackText :text="post.adminReply" />
        </div>
      </div>

      <div v-if="owns(post) && editingId !== post.id" class="mt-4 flex gap-3">
        <button
          type="button"
          class="btn-ghost text-sm text-accent-ink hover:underline"
          @click="startEdit(post)"
        >
          編輯
        </button>
        <button
          type="button"
          class="btn-ghost text-sm text-stone-600 hover:text-tone-danger-ink"
          :disabled="pendingId === post.id"
          @click="remove(post)"
        >
          刪除
        </button>
      </div>

      <form
        v-if="session.isSysadmin"
        class="mt-4 space-y-3 border-t border-edge pt-4"
        @submit.prevent="moderate(post, post.status)"
      >
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label :for="`status-${post.id}`" class="block text-xs font-medium text-ink-muted">
              處理狀態
            </label>
            <select
              :id="`status-${post.id}`"
              class="field mt-2"
              :value="post.status"
              @change="onStatus(post, $event)"
            >
              <option value="pending">待處理</option>
              <option value="in_progress">處理中</option>
              <option value="done">已完成</option>
            </select>
          </div>
        </div>
        <div>
          <label :for="`reply-${post.id}`" class="block text-xs font-medium text-ink-muted">
            管理員回覆
          </label>
          <textarea
            :id="`reply-${post.id}`"
            v-model="replyDrafts[post.id]"
            maxlength="2000"
            rows="3"
            class="field mt-2 w-full"
          ></textarea>
        </div>
        <div class="flex flex-wrap gap-3">
          <button type="submit" class="btn-primary px-3 py-2">儲存回覆</button>
          <button
            v-if="!owns(post)"
            type="button"
            class="btn-ghost text-sm text-stone-600 hover:text-tone-danger-ink"
            @click="remove(post)"
          >
            刪除
          </button>
        </div>
      </form>
    </article>
  </section>
</template>
