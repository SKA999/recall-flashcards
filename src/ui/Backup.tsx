import { useEffect, useRef, useState } from 'react'
import type { Go } from '../App'
import { describeBackup } from '../core/backup-policy'
import {
  chooseBackupFolder,
  folderBackupSupported,
  folderIsWritable,
  forgetBackupFolder,
  regrantFolder,
  requestPersistentStorage,
  savedBackupFolder,
  storageIsPersisted,
  storageUse,
  writeBackupToFolder,
} from '../data/autobackup'
import { backend } from '../data/backend'
import type { RestoreResult } from '../data/backup'
import { useApp } from '../data/store'

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function Backup({ go }: { go: Go }) {
  const { decks, notes, cards, exportBackup, restoreBackup, durable, backupState, markBackedUp } =
    useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<{ usedMB: number; quotaMB: number } | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [folderWritable, setFolderWritable] = useState(true)
  const [autoNote, setAutoNote] = useState<string | null>(null)

  const refreshStorage = async () => {
    setPersisted(await storageIsPersisted())
    setUsage(await storageUse())
    const handle = await savedBackupFolder(backend())
    setFolderName(handle ? handle.name : null)
    setFolderWritable(handle ? await folderIsWritable(handle) : true)
  }

  useEffect(() => {
    void refreshStorage()
  }, [])

  const [busy, setBusy] = useState<'export' | 'restore' | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [restored, setRestored] = useState<RestoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pickFolder = async () => {
    setError(null)
    try {
      const handle = await chooseBackupFolder(backend())
      if (!handle) return
      const written = await writeBackupToFolder(backend(), handle)
      await markBackedUp(written.at)
      setAutoNote(`Saved ${written.filename} to ${handle.name}.`)
      await refreshStorage()
    } catch (e) {
      // An abort is the user closing the picker, which is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'could not use that folder')
    }
  }

  const backUpNow = async () => {
    setError(null)
    const handle = await savedBackupFolder(backend())
    if (!handle) return
    try {
      if (!(await folderIsWritable(handle)) && !(await regrantFolder(handle))) {
        setError('permission for that folder was refused')
        return
      }
      const written = await writeBackupToFolder(backend(), handle)
      await markBackedUp(written.at)
      setAutoNote(`Saved ${written.filename} to ${handle.name}.`)
      await refreshStorage()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not write to that folder')
    }
  }

  const runExport = async () => {
    if (busy) return
    setBusy('export')
    setError(null)
    setRestored(null)
    try {
      const result = await exportBackup()
      // Hand the file to the browser's download machinery.
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Revoke once the download has had a chance to start.
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setSaved(result.filename)
      await markBackedUp()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export failed')
    } finally {
      setBusy(null)
    }
  }

  const runRestore = async (file: File) => {
    if (busy) return
    setBusy('restore')
    setError(null)
    setSaved(null)
    try {
      setRestored(await restoreBackup(await file.arrayBuffer()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'restore failed')
    } finally {
      setBusy(null)
    }
  }

  const empty = decks.length === 0

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost back" onClick={() => go({ name: 'decks' })}>
          <span aria-hidden="true">←</span>
          <span className="name">Decks</span>
        </button>
        <div className="grow">
          <h1>Backup</h1>
        </div>
      </header>

      {!durable && (
        <div className="card notice" style={{ marginBottom: 16 }}>
          This browser won't store data, so there is nothing on disk to back up. Anything you export
          now covers only what you have added in this tab.
        </div>
      )}

      <section className="card chart">
        <h3>Keeping your cards safe</h3>
        <div className="tiny muted">{describeBackup(backupState, Date.now())}</div>
        <div className="stack" style={{ marginTop: 14, gap: 10 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`pill ${persisted ? 'review' : ''}`}>
              {persisted === null ? 'checking…' : persisted ? 'protected' : 'not protected'}
            </span>
            <span className="tiny muted grow">
              {persisted
                ? 'The browser has been asked not to clear this data when space runs short.'
                : 'The browser may clear this data if the device runs low on space. Installing the app to your home screen makes it much more likely to be kept.'}
            </span>
            {persisted === false && (
              <button
                className="btn small"
                onClick={async () => {
                  await requestPersistentStorage()
                  await refreshStorage()
                }}
              >
                Ask again
              </button>
            )}
          </div>
          {usage && (
            <div className="tiny muted">
              Using {usage.usedMB} MB of about {usage.quotaMB} MB available.
            </div>
          )}

          {folderBackupSupported() ? (
            folderName ? (
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="tiny grow">
                  Saving a copy to <strong>{folderName}</strong> once a day, automatically.
                  {!folderWritable && ' Permission has lapsed — the next copy needs a click.'}
                </span>
                <button className="btn small" onClick={backUpNow}>
                  Save now
                </button>
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    await forgetBackupFolder(backend())
                    await refreshStorage()
                  }}
                >
                  Stop
                </button>
              </div>
            ) : (
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="tiny muted grow">
                  Pick a folder once and a copy is written there on the first visit each day, with
                  no prompting.
                </span>
                <button className="btn" onClick={pickFolder}>
                  Choose a folder
                </button>
              </div>
            )
          ) : (
            <div className="tiny muted">
              This browser can't write to a folder on its own — that's a Chrome and Edge feature on
              desktop, and no phone browser offers it. Export by hand here, and keep the file
              somewhere that syncs.
            </div>
          )}
          {autoNote && <div className="tiny muted">{autoNote}</div>}
        </div>
      </section>

      <section className="card chart" style={{ marginTop: 16 }}>
        <h3>Save a copy</h3>
        <div className="tiny muted">
          Your cards live only in this browser. An export writes everything to one file — decks,
          cards, review history, scheduling and media — which you can keep somewhere safe or move to
          another device.
        </div>
        <div className="row wrap" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={busy !== null || empty} onClick={runExport}>
            {busy === 'export' ? 'Preparing…' : 'Export collection'}
          </button>
          <span className="tiny muted">
            {empty
              ? 'Nothing to export yet.'
              : `${plural(decks.length, 'deck')} · ${plural(notes.length, 'note')} · ${plural(cards.length, 'card')}`}
          </span>
        </div>
        {saved && (
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Saved as <strong>{saved}</strong>. It's an ordinary zip — you can open it to check what's
            inside.
          </div>
        )}
      </section>

      <section className="card chart" style={{ marginTop: 16 }}>
        <h3>Restore from a file</h3>
        <div className="tiny muted">
          Adds everything in the backup that isn't here already. Cards you currently have are left
          alone, so restoring can't undo reviews you've done since the backup was taken.
        </div>
        <div className="row wrap" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === 'restore' ? 'Restoring…' : 'Choose a backup'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void runRestore(file)
              e.target.value = ''
            }}
          />
        </div>

        {error && (
          <div className="notice" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        {restored && (
          <div className="stack" style={{ marginTop: 14, gap: 6 }}>
            <div style={{ fontSize: 17, fontWeight: 650 }}>
              Added {plural(restored.notes.length, 'note')} and{' '}
              {plural(restored.cards.length, 'card')}.
            </div>
            {restored.decks.length > 0 && (
              <div className="tiny muted">{plural(restored.decks.length, 'deck')} added.</div>
            )}
            {restored.skipped.notes > 0 && (
              <div className="tiny muted">
                {plural(restored.skipped.notes, 'note')} were already here and were left untouched.
              </div>
            )}
            {restored.missingMedia.length > 0 && (
              <div className="tiny muted">
                {plural(restored.missingMedia.length, 'attachment')} listed in the backup were not
                inside it: {restored.missingMedia.slice(0, 3).join(', ')}
                {restored.missingMedia.length > 3 ? '…' : ''}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => go({ name: 'decks' })}>
                Done
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
