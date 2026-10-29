<script setup lang="ts">
import { appName, appTagline } from '@/config/app'
import { demoAccounts, roleLabels } from '@/data/mock'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()
const selectedId = ref(demoAccounts[0]?.id ?? '')
const failed = ref(false)

const points = [
  {
    mark: '1',
    title: '選擇案件類別',
    detail: '從虛構的類別進入工作台，而不是建立一筆案件紀錄。',
  },
  {
    mark: '2',
    title: '閱讀文件與步驟',
    detail: '每個類別附有相關文件，以及準備草稿時要跟著做的步驟。',
  },
  {
    mark: '3',
    title: '留下草稿檔',
    detail: '上傳只記錄檔名與大小，檔案留在這個分頁，不會送到伺服器。',
  },
]

function submit() {
  failed.value = !session.login(selectedId.value)
  if (failed.value) return
  void router.push(safeRedirect(route.query.redirect))
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)]">
    <section
      class="hidden bg-stone-950 px-10 py-12 text-stone-100 lg:flex lg:flex-col lg:justify-between"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-700 text-sm font-semibold"
        >
          用
        </span>
        <span>
          <span class="block text-base font-semibold">{{ appName }}</span>
          <span class="block text-sm text-stone-400">{{ appTagline }}</span>
        </span>
      </div>
      <div class="max-w-md">
        <p class="text-3xl font-semibold tracking-tight">先選類別，再準備草稿</p>
        <ol class="mt-8 space-y-5">
          <li v-for="point in points" :key="point.mark" class="flex gap-3">
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs"
            >
              {{ point.mark }}
            </span>
            <span>
              <span class="block text-sm font-medium">{{ point.title }}</span>
              <span class="mt-1 block text-sm leading-6 text-stone-400">{{ point.detail }}</span>
            </span>
          </li>
        </ol>
      </div>
      <p class="text-xs leading-5 text-stone-500">
        沒有密碼欄位，也不會連線。重新整理後身分會清除。
      </p>
    </section>

    <section class="flex items-center justify-center bg-[#f6f4f1] px-4 py-10">
      <div
        class="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p class="text-xs font-medium tracking-wide text-orange-800 lg:hidden">{{ appName }}</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight text-stone-950">選擇示範身分</h1>
        <p class="mt-3 text-sm leading-6 text-stone-600">
          以角色進入工作台。此頁沒有密碼，選擇結果只留在這個分頁。
        </p>

        <form class="mt-6" @submit.prevent="submit">
          <fieldset>
            <legend class="sr-only">示範身分</legend>
            <div class="space-y-3">
              <label v-for="account in demoAccounts" :key="account.id" class="block cursor-pointer">
                <input
                  v-model="selectedId"
                  class="peer sr-only"
                  type="radio"
                  name="demo-account"
                  :value="account.id"
                  required
                />
                <span
                  class="block rounded-2xl border border-stone-200 px-4 py-4 transition peer-checked:border-stone-900 peer-checked:bg-stone-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange-700"
                >
                  <span class="flex items-center justify-between gap-3">
                    <span class="text-sm font-semibold text-stone-900">{{
                      account.displayName
                    }}</span>
                    <span class="text-xs text-stone-500">{{ roleLabels[account.role] }}</span>
                  </span>
                  <span class="mt-1 block text-sm leading-6 text-stone-600">{{
                    account.hint
                  }}</span>
                </span>
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            class="mt-6 w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
          >
            進入工作台
          </button>
        </form>

        <p v-if="failed" class="mt-4 text-sm text-rose-800" role="alert">找不到這個示範身分。</p>
        <p class="mt-4 text-xs leading-5 text-stone-500">
          案件送審會在後續階段才接上。現在只準備類別與草稿。
        </p>
      </div>
    </section>
  </div>
</template>
