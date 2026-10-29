<script setup lang="ts">
import { appName, appPhase } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

const session = useSessionStore()
const router = useRouter()
const displayName = ref('')

function submit() {
  session.enter(displayName.value)
  void router.push('/')
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)]">
    <section
      class="hidden bg-stone-900 px-10 py-12 text-stone-100 lg:flex lg:flex-col lg:justify-between"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-700 text-sm font-semibold"
        >
          用
        </span>
        <span>
          <span class="block text-base font-semibold">{{ appName }}</span>
          <span class="block text-sm text-stone-400">{{ appPhase }}</span>
        </span>
      </div>
      <div class="max-w-md">
        <h1 class="text-3xl font-semibold tracking-tight">進入示範工作區</h1>
        <p class="mt-4 text-sm leading-7 text-stone-300">
          側邊欄與上方列會帶你瀏覽總覽、案件、人員與存取權限。這個階段沒有後端，所有清單都是內建示範資料。
        </p>
      </div>
      <p class="text-xs text-stone-500">不會收集密碼，也不會連線。</p>
    </section>

    <section class="flex items-center justify-center bg-stone-100 px-4 py-10">
      <div
        class="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p class="text-xs font-medium text-orange-800">{{ appPhase }}</p>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight">登入</h1>
        <p class="mt-3 text-sm leading-6 text-stone-600">
          這是佔位頁面。按下按鈕只會把顯示名稱留在這個分頁的記憶體，不會送到伺服器。
        </p>

        <form class="mt-6 space-y-4" @submit.prevent="submit">
          <div>
            <label for="display-name" class="block text-sm font-medium text-stone-800">
              顯示名稱
            </label>
            <input
              id="display-name"
              v-model="displayName"
              type="text"
              name="display-name"
              maxlength="40"
              autocomplete="off"
              placeholder="可留空，將以示範使用者進入"
              class="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-orange-700"
            />
          </div>
          <button
            type="submit"
            class="w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
          >
            以示範身分進入
          </button>
        </form>

        <p v-if="session.entered" class="mt-4 text-sm text-stone-600">
          目前分頁的顯示名稱是{{ session.displayName }}。
        </p>

        <RouterLink to="/" class="mt-6 inline-flex text-sm text-orange-800 hover:underline">
          返回總覽
        </RouterLink>
      </div>
    </section>
  </div>
</template>
