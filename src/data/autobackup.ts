// Keeping a copy of the collection without anyone having to remember to.
//
// A browser cannot write to disk on its own, so what is possible depends on the
// platform, and the two halves of this file cover the two cases:
//
//   Desktop Chromium — the user picks a folder once and grants permission;
//   after that a backup can be written silently on the first visit each day.
//
//   Everywhere else, phones included — no folder access exists, so the best
//   available protection is asking the browser not to evict the data, and
//   telling the user when a copy is overdue.
//
// The phone is where the risk actually lives, and it is the platform with the
// weaker option. That is worth being honest about rather than papering over.

import { exportCollection } from './backup'
import type { Store } from '../core/storage'

const FOLDER_KEY = 'backup.folder'
const LAST_BACKUP_KEY = 'backup.lastAt'
const REVIEWS_AT_BACKUP_KEY = 'backup.reviewsAt'

/** A directory handle, minus the parts of the DOM types we do not need. */
type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
}

/**
 * The File System Access API is Chromium-only, so it is absent from the DOM
 * types. Declared narrowly here rather than pulled in wholesale.
 */
interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: string
}
type WindowWithPicker = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  }

const picker = (): WindowWithPicker['showDirectoryPicker'] =>
  typeof window === 'undefined' ? undefined : (window as WindowWithPicker).showDirectoryPicker

export function folderBackupSupported(): boolean {
  return typeof picker() === 'function'
}

/**
 * Ask the browser to keep this data even when space runs short.
 *
 * This is the only eviction protection available on a phone. Browsers grant it
 * based on their own signals — an installed web app and repeated use both help
 * — so a refusal is not an error, just a no.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageIsPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}

export interface StorageUse {
  usedMB: number
  quotaMB: number
}

export async function storageUse(): Promise<StorageUse | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate?.quota) return null
    return {
      usedMB: Math.round(((estimate.usage ?? 0) / 1_048_576) * 10) / 10,
      quotaMB: Math.round((estimate.quota ?? 0) / 1_048_576),
    }
  } catch {
    return null
  }
}

/** Prompt for a folder and remember it. Requires a click to satisfy the browser. */
export async function chooseBackupFolder(store: Store): Promise<DirectoryHandle | null> {
  const open = picker()
  if (!open) return null
  const handle = (await open({
    id: 'recall-backups',
    mode: 'readwrite',
    startIn: 'documents',
  })) as DirectoryHandle
  await store.putSetting(FOLDER_KEY, handle)
  return handle
}

export async function savedBackupFolder(store: Store): Promise<DirectoryHandle | null> {
  return (await store.getSetting<DirectoryHandle>(FOLDER_KEY)) ?? null
}

export async function forgetBackupFolder(store: Store): Promise<void> {
  await store.putSetting(FOLDER_KEY, undefined)
}

/**
 * Is the saved folder still writable without asking?
 *
 * Chrome only keeps the permission when the user chose to allow it on every
 * visit; otherwise it reverts to `prompt`, and re-requesting needs a click.
 * A silent daily backup therefore cannot be guaranteed, which is why the
 * reminder exists alongside it.
 */
export async function folderIsWritable(handle: DirectoryHandle): Promise<boolean> {
  try {
    return (await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** Ask for permission again. Must be called from a user gesture. */
export async function regrantFolder(handle: DirectoryHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

export interface WrittenBackup {
  filename: string
  bytes: number
  at: number
}

/** Write the collection into the chosen folder, overwriting the day's file. */
export async function writeBackupToFolder(
  store: Store,
  handle: DirectoryHandle,
  now = Date.now(),
): Promise<WrittenBackup> {
  const result = await exportCollection(store, now)
  const file = await handle.getFileHandle(result.filename, { create: true })
  const writable = await file.createWritable()
  await writable.write(result.blob)
  await writable.close()
  return { filename: result.filename, bytes: result.blob.size, at: now }
}

/** Remember that a copy was taken, and how much history it covered. */
export async function recordBackup(store: Store, at: number, reviewCount: number): Promise<void> {
  await store.putSetting(LAST_BACKUP_KEY, at)
  await store.putSetting(REVIEWS_AT_BACKUP_KEY, reviewCount)
}

export async function readBackupMarks(
  store: Store,
): Promise<{ lastBackupAt?: number; reviewsAtBackup: number }> {
  const [lastBackupAt, reviewsAtBackup] = await Promise.all([
    store.getSetting<number>(LAST_BACKUP_KEY),
    store.getSetting<number>(REVIEWS_AT_BACKUP_KEY),
  ])
  return { lastBackupAt, reviewsAtBackup: reviewsAtBackup ?? 0 }
}
