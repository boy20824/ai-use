<script setup lang="ts">
const nameField = '{{被害人姓名}}'
const dateField = '{{日期}}'
const dateSlashField = '{{日期_民國}}'
const yearField = '{{年}}'
const monthField = '{{月}}'
const dayField = '{{日}}'
const longExample = '115年10月29日'
const slashExample = '115/10/29'
const photoSyntax = '{{#照片頁}}…{{/照片頁}}'
const cellSyntax = '{{#照片格}}…{{/照片格}}'
const photoTags = '{{照片}}、{{照片編號}}、{{攝影時間}}、{{攝影地點}}、{{攝影人}}、{{照片說明}}'
</script>

<template>
  <div
    class="rounded-2xl border border-edge bg-surface-muted px-4 py-4 text-sm leading-6 text-stone-700"
  >
    <p class="font-medium text-ink">欄位寫法</p>
    <p class="mt-2">
      在 Word 範本中用雙大括號標示要帶入的欄位，例如
      <code class="rounded bg-surface px-1.5 py-0.5 text-ink ring-1 ring-stone-200">{{
        nameField
      }}</code>
      。日期用民國年，預設為台北今天，可再修改。月、日不補零：
      <code class="rounded bg-surface px-1.5 py-0.5 text-ink ring-1 ring-stone-200">{{
        dateField
      }}</code>
      會寫成 {{ longExample }}，
      <code class="rounded bg-surface px-1.5 py-0.5 text-ink ring-1 ring-stone-200">{{
        dateSlashField
      }}</code>
      會寫成 {{ slashExample }}，
      <code class="rounded bg-surface px-1.5 py-0.5 text-ink ring-1 ring-stone-200">{{
        yearField
      }}</code>
      、
      <code class="rounded bg-surface px-1.5 py-0.5 text-ink ring-1 ring-stone-200">{{
        monthField
      }}</code>
      、
      <code class="rounded bg-surface px-1.5 py-0.5 text-ink ring-1 ring-stone-200">{{
        dayField
      }}</code>
      會分別寫成 115、10、29。這幾個日期欄位由系統帶入，不會另外出現輸入欄。
    </p>
    <p class="mt-2">
      若 Word
      把同一個欄位拆到不同字型或格式，上傳時會合併，並沿用第一個字的格式。欄位在使用範本的步驟填寫，同名欄位共用；產生文件時套用填寫內容，內容不會被保存。
    </p>
    <p class="mt-2 font-medium text-ink">動態照片區塊</p>
    <p class="mt-2">
      每份範本可設定一個
      {{ photoSyntax }}，起訖標記各獨占本文的一個段落，包住標題段落與一張表格。表格內每格用
      {{ cellSyntax }}
      包住完整連續的列：起始標記放在第一列第一段開頭，結尾放在最後一列最後一段結尾；不可巢狀或共用同一列。
      放幾個照片格就是每頁幾格；頁內不要自行插入分頁或分節。
    </p>
    <p class="mt-2">
      格內可使用 {{ photoTags }}。照片標記須獨占一段，所在儲存格設定固定的 dxa
      寬度與列高，圖片會等比例縮入格子。
      照片編號自帶全形括號，請寫「編號」接照片編號標記。一般標記可照常放在表頭。
      最後一頁不足的格保留標題與框線；未選照片時整段照片頁移除。照片只在產文件的畫面暫存，不送出也不保存。
    </p>
    <a
      class="mt-2 inline-block text-accent-ink underline"
      href="/templates/scene-photos-template.docx"
      download
      >下載 Mock 照片區塊範本（每頁 2 格）</a
    >
  </div>
</template>
