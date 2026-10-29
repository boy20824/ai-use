<script setup lang="ts">
const nameField = '{{姓名}}'
const dateField = '{{日期}}'
const dateSlashField = '{{日期_民國}}'
const yearField = '{{年}}'
const monthField = '{{月}}'
const dayField = '{{日}}'
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
      。日期用民國年，預設為台北今天，可再修改。月、日不補零：
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        dateField
      }}</code>
      會寫成 {{ longExample }}，
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        dateSlashField
      }}</code>
      會寫成 {{ slashExample }}，
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        yearField
      }}</code>
      、
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        monthField
      }}</code>
      、
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        dayField
      }}</code>
      會分別寫成 115、10、29。這幾個日期欄位由系統帶入，不會另外出現輸入欄。
    </p>
    <p class="mt-2">
      若 Word
      把同一個欄位拆到不同字型或格式，上傳時會合併，並沿用第一個字的格式。產生文件時套用基本資料，填入的內容不會被保存。
    </p>
  </div>
</template>
