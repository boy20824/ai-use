<script setup lang="ts">
import { isValidRocDate, parseRocDate } from '@/utils/rocDate'
import { computed, ref, watch } from 'vue'

const model = defineModel<string>({ required: true })

const years = Array.from({ length: 150 }, (_, index) => index + 1)
const months = Array.from({ length: 12 }, (_, index) => index + 1)
const days = Array.from({ length: 31 }, (_, index) => index + 1)

const year = ref('')
const month = ref('')
const day = ref('')

const invalid = computed(() => {
  if (!year.value || !month.value || !day.value) return false
  return !isValidRocDate(Number(year.value), Number(month.value), Number(day.value))
})

watch(
  model,
  (value) => {
    if (!value) {
      if (year.value && month.value && day.value) {
        year.value = ''
        month.value = ''
        day.value = ''
      }
      return
    }
    const parsed = parseRocDate(value)
    const loose = value.match(/^(\d{1,3})\/(\d{1,2})\/(\d{1,2})$/)
    const source =
      parsed ??
      (loose ? { rocYear: Number(loose[1]), month: Number(loose[2]), day: Number(loose[3]) } : null)
    if (!source) return
    year.value = String(source.rocYear)
    month.value = String(source.month)
    day.value = String(source.day)
  },
  { immediate: true },
)

function publish() {
  if (!year.value || !month.value || !day.value) {
    model.value = ''
    return
  }
  model.value = `${Number(year.value)}/${Number(month.value)}/${Number(day.value)}`
}

const selectClass =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-700'
</script>

<template>
  <div>
    <div class="mt-2 grid grid-cols-3 gap-2">
      <label class="block">
        <span class="sr-only">民國年</span>
        <select v-model="year" :class="selectClass" @change="publish">
          <option value="">年</option>
          <option v-for="item in years" :key="item" :value="String(item)">{{ item }}</option>
        </select>
      </label>
      <label class="block">
        <span class="sr-only">月</span>
        <select v-model="month" :class="selectClass" @change="publish">
          <option value="">月</option>
          <option v-for="item in months" :key="item" :value="String(item)">{{ item }}</option>
        </select>
      </label>
      <label class="block">
        <span class="sr-only">日</span>
        <select v-model="day" :class="selectClass" @change="publish">
          <option value="">日</option>
          <option v-for="item in days" :key="item" :value="String(item)">{{ item }}</option>
        </select>
      </label>
    </div>
    <p v-if="invalid" class="mt-1 text-xs text-rose-800">這個民國日期不存在。</p>
  </div>
</template>
