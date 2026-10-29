<script setup lang="ts">
const nameField = '{{姓名}}'
const dateField = '{{日期}}'
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
      、
      <code class="rounded bg-white px-1.5 py-0.5 text-stone-900 ring-1 ring-stone-200">{{
        dateField
      }}</code>
      。
    </p>
    <p class="mt-2">
      名稱請放在同一段文字，不要在括號中間換行或套上不同字型。產生文件時會詢問這些欄位，並套用到此類別的每一份範本。
    </p>
  </div>
</template>
