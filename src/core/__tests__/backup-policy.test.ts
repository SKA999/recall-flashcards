import { describe, expect, it } from 'vitest'
import {
  BACKUP_INTERVAL_MS,
  BACKUP_STALE_MS,
  backupDue,
  backupUrgency,
  daysSinceBackup,
  describeBackup,
} from '../backup-policy'

const NOW = new Date(2026, 7, 23, 12, 0, 0).getTime()
const hoursAgo = (h: number) => NOW - h * 3_600_000

describe('when a backup is due', () => {
  it('is due once a day has passed and there is something new', () => {
    expect(backupDue({ lastBackupAt: hoursAgo(25), changesSince: 4 }, NOW)).toBe(true)
    expect(backupDue({ lastBackupAt: hoursAgo(23), changesSince: 4 }, NOW)).toBe(false)
  })

  it('is due immediately when no copy has ever been taken', () => {
    expect(backupDue({ changesSince: 1 }, NOW)).toBe(true)
  })

  it('is never due when nothing has changed', () => {
    // Rewriting an identical file teaches people to ignore the reminder.
    expect(backupDue({ lastBackupAt: hoursAgo(24 * 30), changesSince: 0 }, NOW)).toBe(false)
    expect(backupDue({ changesSince: 0 }, NOW)).toBe(false)
  })

  it('treats exactly one day as due', () => {
    expect(backupDue({ lastBackupAt: NOW - BACKUP_INTERVAL_MS, changesSince: 1 }, NOW)).toBe(true)
  })
})

describe('how loudly to mention it', () => {
  it('says nothing when a copy is current', () => {
    expect(backupUrgency({ lastBackupAt: hoursAgo(2), changesSince: 3 }, NOW)).toBe('none')
  })

  it('says nothing when there is nothing to save', () => {
    expect(backupUrgency({ lastBackupAt: hoursAgo(24 * 60), changesSince: 0 }, NOW)).toBe('none')
  })

  it('separates a day old from a week old', () => {
    expect(backupUrgency({ lastBackupAt: hoursAgo(30), changesSince: 5 }, NOW)).toBe('due')
    expect(backupUrgency({ lastBackupAt: NOW - BACKUP_STALE_MS, changesSince: 5 }, NOW)).toBe('stale')
  })

  it('flags a collection that has never been saved', () => {
    expect(backupUrgency({ changesSince: 12 }, NOW)).toBe('never')
  })
})

describe('describing the state', () => {
  it('counts days rather than hours', () => {
    expect(daysSinceBackup(hoursAgo(30), NOW)).toBe(1)
    expect(daysSinceBackup(hoursAgo(2), NOW)).toBe(0)
    expect(daysSinceBackup(undefined, NOW)).toBeUndefined()
  })

  it('reads naturally for today and yesterday', () => {
    expect(describeBackup({ lastBackupAt: hoursAgo(1), changesSince: 3 }, NOW)).toBe(
      'Last saved today, 3 reviews ago.',
    )
    expect(describeBackup({ lastBackupAt: hoursAgo(30), changesSince: 1 }, NOW)).toBe(
      'Last saved yesterday, 1 review ago.',
    )
  })

  it('says so when there is nothing outstanding', () => {
    expect(describeBackup({ lastBackupAt: hoursAgo(30), changesSince: 0 }, NOW)).toBe(
      'Last saved yesterday. Nothing has changed since.',
    )
  })

  it('distinguishes never-saved-and-empty from never-saved-with-work', () => {
    expect(describeBackup({ changesSince: 0 }, NOW)).toBe('Nothing saved yet, and nothing to save.')
    expect(describeBackup({ changesSince: 9 }, NOW)).toBe('No copy has ever been saved.')
  })
})
