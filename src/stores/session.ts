import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const displayName = ref('訪客')
  const entered = ref(false)

  function enter(name: string) {
    const trimmed = name.trim().slice(0, 40)
    displayName.value = trimmed.length > 0 ? trimmed : '示範使用者'
    entered.value = true
  }

  function leave() {
    displayName.value = '訪客'
    entered.value = false
  }

  return { displayName, entered, enter, leave }
})
