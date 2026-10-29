import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const appUid = 1001
const appGid = 1001

function dataDirectories(targets: string[]): string[] {
  const directories = new Set<string>()
  for (const target of targets) {
    if (target === ':memory:' || !path.isAbsolute(target)) continue
    directories.add(path.dirname(target))
  }
  return [...directories]
}

export function dropRootPrivileges(targets: string[]) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return
  const directories = dataDirectories(targets)
  for (const directory of directories) mkdirSync(directory, { recursive: true })
  for (const directory of directories) {
    const owned = spawnSync('chown', ['-R', `${appUid}:${appGid}`, directory], {
      stdio: 'inherit',
    })
    if (owned.status !== 0) {
      throw new Error(`無法變更 ${directory} 的擁有者，拒絕以 root 啟動。`)
    }
  }
  const setgid = process.setgid
  const setuid = process.setuid
  if (typeof setgid !== 'function' || typeof setuid !== 'function') {
    throw new Error('這個環境不能放棄 root。')
  }
  setgid(appGid)
  setuid(appUid)
  if (process.getuid() === 0) {
    throw new Error('行程仍是 root，拒絕啟動。')
  }
}
