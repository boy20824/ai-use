<script setup lang="ts">
import ConfirmDialog from './ConfirmDialog.vue'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import RocDateField from './RocDateField.vue'
import PhotoThumbnail from './PhotoThumbnail.vue'
import {
  maxPhotoCount,
  movePhoto,
  photoNumber,
  photoPageCount,
  type PhotoDraft,
  type PhotoValues,
} from '../../shared/photoBlockRender'
import { loadBlockPhoto } from '@/photos/files'
import { defaultRocDateSlash } from '@/utils/rocDate'
const props = defineProps<{
  templateId: string
  cells: number
  draft?: PhotoDraft
  busy?: boolean
}>()
const emit = defineEmits<{
  update: [draft: PhotoDraft]
  processing: [id: symbol, active: boolean]
}>()
const empty: PhotoDraft = {
  common: { time: defaultRocDateSlash(), location: '', photographer: '' },
  photos: [],
}
const state = computed(() => props.draft ?? empty)
const error = ref('')
const loading = ref(false)
let disposed = false
let dragged = -1
const processingId = Symbol('photo-upload')
onBeforeUnmount(() => {
  disposed = true
  emit('processing', processingId, false)
})
function common(key: keyof PhotoValues, value: string) {
  emit('update', { ...state.value, common: { ...state.value.common, [key]: value } })
}
function description(index: number, value: string) {
  emit('update', {
    ...state.value,
    photos: state.value.photos.map((p, n) => (n === index ? { ...p, description: value } : p)),
  })
}
function override(index: number, key: keyof PhotoValues, value: string) {
  emit('update', {
    ...state.value,
    photos: state.value.photos.map((p, n) =>
      n === index ? { ...p, overrides: { ...p.overrides, [key]: value } } : p,
    ),
  })
}
function toggleOverride(index: number, enabled: boolean) {
  emit('update', {
    ...state.value,
    photos: state.value.photos.map((p, n) =>
      n === index ? { ...p, overrides: enabled ? {} : undefined } : p,
    ),
  })
}
function move(from: number, to: number) {
  if (props.busy || loading.value) return
  emit('update', { ...state.value, photos: movePhoto(state.value.photos, from, to) })
}
const pendingRemove = ref<string | null>(null)
function confirmRemove() {
  emit('update', {
    ...state.value,
    photos: state.value.photos.filter((photo) => photo.id !== pendingRemove.value),
  })
  pendingRemove.value = null
}
async function add(files: File[]) {
  if (loading.value || props.busy || disposed) return
  loading.value = true
  emit('processing', processingId, true)
  error.value = ''
  const errors: string[] = []
  try {
    for (const file of files) {
      if (disposed) return
      if (state.value.photos.length >= maxPhotoCount) {
        errors.push(`每份範本最多 ${maxPhotoCount} 張照片。`)
        break
      }
      try {
        const photo = await loadBlockPhoto(file)
        if (disposed) return
        if (state.value.photos.length >= maxPhotoCount) {
          errors.push(`每份範本最多 ${maxPhotoCount} 張照片。`)
          break
        }
        emit('update', { ...state.value, photos: [...state.value.photos, photo] })
        // Let the parent publish its updated draft before the next asynchronous decode.
        await nextTick()
      } catch (cause) {
        errors.push(`${file.name}：${cause instanceof Error ? cause.message : '無法讀取照片。'}`)
      }
    }
    error.value = errors.join(' ')
  } finally {
    loading.value = false
    emit('processing', processingId, false)
  }
}
function select(event: Event) {
  const input = event.target as HTMLInputElement
  void add(Array.from(input.files ?? []))
  input.value = ''
}
function drop(event: DragEvent) {
  if (event.dataTransfer?.files.length) void add(Array.from(event.dataTransfer.files))
}
function reorderDrop(event: DragEvent, index: number) {
  if (event.dataTransfer?.files.length) {
    drop(event)
    return
  }
  if (dragged >= 0) move(dragged, index)
  dragged = -1
}
function dragStart(event: DragEvent, index: number) {
  dragged = index
  event.dataTransfer?.setData('text/plain', String(index))
}
</script>
<template>
  <ConfirmDialog
    v-if="pendingRemove !== null"
    title="刪除照片"
    @confirm="confirmRemove"
    @cancel="pendingRemove = null"
  >
    將刪除這張照片、照片說明與覆寫的攝影資料，需要時須重新加入照片。
  </ConfirmDialog>
  <section
    class="mt-3 w-full rounded-control border border-edge p-3"
    :aria-label="`照片區塊 ${templateId}`"
    @dragover.prevent
    @drop.prevent="drop"
  >
    <p class="text-sm font-medium text-ink">照片區塊（每頁 {{ cells }} 格）</p>
    <p class="mt-1 text-xs text-ink-muted">
      照片僅在本機記憶體處理，離開或重新整理後清除。限 PNG/JPEG，單張 10 MB、最多 30 張；長邊會縮至
      1600 像素。
    </p>
    <fieldset :disabled="busy || loading" class="mt-3 min-w-0">
      <label class="btn-secondary inline-flex cursor-pointer"
        >新增照片
        <input
          class="sr-only"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          @change="select"
        />
      </label>
      <span class="ml-2 text-xs text-ink-muted">或將照片拖放到此區</span>
      <p v-if="loading" role="status" class="mt-2 text-sm">正在本機處理照片…</p>
      <div class="mt-3 grid gap-3">
        <div>
          <span class="text-sm">共用攝影時間（民國年）</span
          ><RocDateField
            :model-value="state.common.time"
            @update:model-value="common('time', $event)"
          />
        </div>
        <label class="text-sm"
          >共用攝影地點<input
            class="field mt-1 w-full"
            :value="state.common.location"
            autocomplete="off"
            @input="common('location', ($event.target as HTMLInputElement).value)"
        /></label>
        <label class="text-sm"
          >共用攝影人<input
            class="field mt-1 w-full"
            :value="state.common.photographer"
            autocomplete="off"
            @input="common('photographer', ($event.target as HTMLInputElement).value)"
        /></label>
      </div>
      <ol class="mt-3 space-y-3" aria-label="照片清單">
        <li
          v-for="(photo, index) in state.photos"
          :key="photo.id"
          class="rounded-control border border-edge p-3"
          @dragover.prevent
          @drop.stop.prevent="reorderDrop($event, index)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="cursor-move text-sm font-medium"
              :draggable="!busy && !loading"
              @dragstart="dragStart($event, index)"
              @dragend="dragged = -1"
              >編號{{ photoNumber(index) }}（拖曳排序）</span
            >
            <button
              type="button"
              class="btn-ghost"
              :disabled="index === 0"
              :aria-label="`照片${index + 1}上移`"
              @click="move(index, index - 1)"
            >
              上移
            </button>
            <button
              type="button"
              class="btn-ghost"
              :disabled="index === state.photos.length - 1"
              :aria-label="`照片${index + 1}下移`"
              @click="move(index, index + 1)"
            >
              下移
            </button>
            <button
              type="button"
              class="btn-ghost"
              :aria-label="`刪除照片${index + 1}`"
              @click="pendingRemove = photo.id"
            >
              刪除
            </button>
          </div>
          <PhotoThumbnail :photo="photo" />
          <label class="mt-2 block text-sm"
            >照片{{ index + 1 }}說明<textarea
              class="field mt-1 w-full"
              :value="photo.description"
              @input="description(index, ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <label class="mt-2 inline-flex items-center gap-2 text-sm"
            ><input
              type="checkbox"
              :checked="!!photo.overrides"
              @change="toggleOverride(index, ($event.target as HTMLInputElement).checked)"
            />覆寫共用值</label
          >
          <div v-if="photo.overrides" class="mt-2 grid gap-2">
            <div>
              <span class="text-sm">照片{{ index + 1 }}攝影時間</span
              ><RocDateField
                :model-value="photo.overrides.time ?? state.common.time"
                @update:model-value="override(index, 'time', $event)"
              />
            </div>
            <label class="text-sm"
              >照片{{ index + 1 }}攝影地點<input
                class="field mt-1 w-full"
                :value="photo.overrides.location ?? state.common.location"
                @input="override(index, 'location', ($event.target as HTMLInputElement).value)"
            /></label>
            <label class="text-sm"
              >照片{{ index + 1 }}攝影人<input
                class="field mt-1 w-full"
                :value="photo.overrides.photographer ?? state.common.photographer"
                @input="override(index, 'photographer', ($event.target as HTMLInputElement).value)"
            /></label>
          </div>
        </li>
      </ol>
    </fieldset>
    <p class="mt-3 text-sm" role="status">
      預覽頁數：{{ state.photos.length }} 張 → {{ photoPageCount(state.photos.length, cells) }} 頁
    </p>
    <p v-if="!state.photos.length" class="mt-1 text-sm text-amber-900">
      尚未新增照片；現在產出時，照片區塊會整段移除，不保留空白頁。
    </p>
    <p v-if="error" role="alert" class="mt-2 text-sm text-tone-danger-ink">{{ error }}</p>
  </section>
</template>
