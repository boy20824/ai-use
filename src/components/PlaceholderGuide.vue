<script setup lang="ts">
const nameField = '{{姓名}}'
const dateField = '{{日期}}'
const dateSlashField = '{{日期_民國}}'
const longExample = '115年10月29日'
const slashExample = '115/10/29'
</script>

<template>
  <div
    class="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm leading-6 text-stone-700"
  >
    <p class="font-medium text-stone-900">欄位寫法</p>
    <p class="mt-2">
      在 Word 範本中用雙大括號標示要帶入的欄位，例如
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        nameField
      }}</code>
      。日期請用民國年：
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        dateField
      }}</code>
      會寫成 {{ longExample }}，
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        dateSlashField
      }}</code>
      會寫成 {{ slashExample }}。
    </p>
    <p class="mt-2">
      名稱請放在同一段文字，不要在括號中間換行或套上不同字型。產生文件時會詢問這些欄位，並套用到該類別連結的每一份範本。填入的內容不會被保存。
    </p>
  </div>
</template>
