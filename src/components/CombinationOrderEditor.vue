<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import type { CaseCategory } from '@/types/domain'
import { combinationKey, resolveCombination } from '@/workbench/compose'
import { apiErrorMessage, apiRequest } from '@/services/api'
import { restoreMoveFocus } from '@/utils/stepFocus'
import { useCategoryStore } from '@/stores/categories'

const props = defineProps<{ category: CaseCategory; managedByForm?: boolean }>()
const categories = useCategoryStore()
const selected = ref<string[]>([])
const draft = ref<string[]>([])
const baseline = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const dragging = ref<string | null>(null)
const resolved = computed(() => resolveCombination(props.category, selected.value))
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(baseline.value))
const steps = computed(() => new Map(resolved.value.steps.map((s) => [s.id, s])))
function reset() {
  baseline.value = resolved.value.steps.map((s) => s.id)
  draft.value = [...baseline.value]
}
watch(
  resolved,
  () => {
    if (!dirty.value) reset()
    else {
      const valid = new Set(resolved.value.steps.map((s) => s.id))
      draft.value = [
        ...draft.value.filter((id) => valid.has(id)),
        ...resolved.value.steps.map((s) => s.id).filter((id) => !draft.value.includes(id)),
      ]
      baseline.value = resolved.value.steps.map((s) => s.id)
    }
  },
  { immediate: true },
)
function canLeave() {
  return !busy.value && (!dirty.value || window.confirm('步驟順序尚未儲存，確定放棄調整？'))
}
if (!props.managedByForm) {
  onBeforeRouteLeave(canLeave)
  onBeforeRouteUpdate(canLeave)
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
}
defineExpose({ dirty, busy })
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || busy.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function toggle(id: string, event: Event) {
  const input = event.target as HTMLInputElement
  if (!canLeave()) {
    input.checked = selected.value.includes(id)
    return
  }
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id]
  error.value = ''
  reset()
}
function move(id: string, target: number, button?: HTMLButtonElement) {
  const index = draft.value.indexOf(id)
  if (busy.value || index < 0 || target < 0 || target >= draft.value.length) return
  draft.value.splice(index, 1)
  draft.value.splice(target, 0, id)
  if (button) void restoreMoveFocus(button)
}
function startDrag(id: string, event: DragEvent) {
  dragging.value = null
  if (busy.value || !draft.value.includes(id)) {
    event.preventDefault()
    return
  }
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
  }
  dragging.value = id
}
function drop(target: number) {
  if (dragging.value) move(dragging.value, target)
  dragging.value = null
}
function sources(id: string) {
  return [
    ...(props.category.baseSteps?.some((r) => r.stepId === id) ? ['基本步驟'] : []),
    ...(props.category.modules ?? [])
      .filter((m) => selected.value.includes(m.id) && m.steps.some((r) => r.stepId === id))
      .map((m) => m.name),
  ].join('、')
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const stepIds = [...draft.value]
  try {
    const response = await apiRequest(
      `/api/categories/${encodeURIComponent(props.category.id)}/combination-order`,
      {
        method: 'PUT',
        body: JSON.stringify({ moduleIds: JSON.parse(combinationKey(selected.value)), stepIds }),
      },
    )
    if (!response.ok) throw new Error(await apiErrorMessage(response, '無法儲存組合順序。'))
    baseline.value = stepIds
    await categories.reload()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法儲存組合順序。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section aria-label="這個情境的步驟順序" class="space-y-3 rounded-2xl border border-edge p-4">
    <h2 class="font-semibold">這個情境的步驟順序</h2>
    <p>勾選情境後可拖曳調整順序。未勾選時只調整基本步驟。</p>
    <fieldset :disabled="busy" class="flex flex-wrap gap-3">
      <legend>選擇情境</legend>
      <label v-for="m in category.modules" :key="m.id">
        <input
          type="checkbox"
          :checked="selected.includes(m.id)"
          :aria-label="`組合：${m.name}`"
          @change="toggle(m.id, $event)"
        />
        {{ m.name }}
      </label>
    </fieldset>
    <p v-if="resolved.stale" role="status">
      此組合步驟已變更：失效步驟已忽略，新步驟依原合成順序附加末尾。請檢查並儲存順序。
    </p>
    <p role="status">{{ dirty ? '順序尚未儲存' : '順序無未儲存調整' }}</p>
    <ol class="space-y-3">
      <li
        v-for="(id, index) in draft"
        :key="id"
        :data-step-id="id"
        :draggable="!busy"
        class="rounded-control bg-surface-muted p-3"
        @dragstart="startDrag(id, $event)"
        @dragend="dragging = null"
        @dragover.prevent
        @drop.prevent="drop(index)"
      >
        <p>{{ steps.get(id)?.title ?? steps.get(id)?.body }}</p>
        <p v-if="steps.get(id)?.canRunInParallel" class="text-sm">此步驟可請其他人同步進行</p>
        <p class="text-xs">來源：{{ sources(id) }}</p>
        <button
          type="button"
          class="btn-ghost"
          :aria-label="`${steps.get(id)?.title ?? steps.get(id)?.body}：上移`"
          :disabled="busy || index === 0"
          data-move="up"
          @click="move(id, index - 1, $event.currentTarget as HTMLButtonElement)"
        >
          上移
        </button>
        <button
          type="button"
          class="btn-ghost"
          :aria-label="`${steps.get(id)?.title ?? steps.get(id)?.body}：下移`"
          :disabled="busy || index === draft.length - 1"
          data-move="down"
          @click="move(id, index + 1, $event.currentTarget as HTMLButtonElement)"
        >
          下移
        </button>
      </li>
    </ol>
    <button
      type="button"
      class="btn-primary"
      :disabled="busy || (!dirty && !resolved.stale)"
      @click="save"
    >
      儲存為這組情境搭配的預設順序
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
