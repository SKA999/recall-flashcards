// When a backup is due, and how to say so.
//
// Pure: the rules live here so they can be tested without a browser, and so a
// native app can reuse them.

export const DAY_MS = 86_400_000

/** A backup a day. Frequent enough that a loss costs one session at most. */
export const BACKUP_INTERVAL_MS = DAY_MS

/** Past this, the nudge stops being a hint and starts being a warning. */
export const BACKUP_STALE_MS = 7 * DAY_MS

export interface BackupState {
  /** Last successful backup, epoch ms; undefined if there has never been one. */
  lastBackupAt?: number
  /** Reviews recorded since that backup. Nothing to save means nothing to nag about. */
  changesSince: number
}

/**
 * Should a backup run now?
 *
 * A backup with nothing new in it is noise — it rewrites the same file and
 * teaches the user to ignore the reminder — so an unchanged collection is never
 * due, however old the last copy is.
 */
export function backupDue(state: BackupState, now: number): boolean {
  if (state.changesSince === 0) return false
  if (state.lastBackupAt == null) return true
  return now - state.lastBackupAt >= BACKUP_INTERVAL_MS
}

/** Days since the last backup, or undefined if there has never been one. */
export function daysSinceBackup(lastBackupAt: number | undefined, now: number): number | undefined {
  if (lastBackupAt == null) return undefined
  return Math.floor((now - lastBackupAt) / DAY_MS)
}

export type BackupUrgency = 'none' | 'due' | 'stale' | 'never'

/**
 * How loudly to mention it. `never` and `stale` earn a visible warning; `due`
 * is a quiet note, because the automatic path may well handle it unprompted.
 */
export function backupUrgency(state: BackupState, now: number): BackupUrgency {
  if (state.changesSince === 0) return 'none'
  if (state.lastBackupAt == null) return 'never'
  const elapsed = now - state.lastBackupAt
  if (elapsed >= BACKUP_STALE_MS) return 'stale'
  if (elapsed >= BACKUP_INTERVAL_MS) return 'due'
  return 'none'
}

/** One sentence describing where things stand, for the backup screen. */
export function describeBackup(state: BackupState, now: number): string {
  const days = daysSinceBackup(state.lastBackupAt, now)
  if (days == null) {
    return state.changesSince === 0
      ? 'Nothing saved yet, and nothing to save.'
      : 'No copy has ever been saved.'
  }
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  if (state.changesSince === 0) return `Last saved ${when}. Nothing has changed since.`
  const reviews = `${state.changesSince} review${state.changesSince === 1 ? '' : 's'}`
  return `Last saved ${when}, ${reviews} ago.`
}
