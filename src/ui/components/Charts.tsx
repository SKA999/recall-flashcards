// Chart primitives. Plain flex/CSS rather than SVG so bars stay responsive
// without measuring, and so rounded ends don't distort on resize.

import { useState } from 'react'

export interface Datum {
  label: string
  value: number
  /** Extra line shown in the tooltip. */
  detail?: string
}

interface BarChartProps {
  title: string
  subtitle?: string
  data: Datum[]
  /** Bar colour role: past activity vs. future scheduling. */
  variant?: 'past' | 'forecast'
  height?: number
  unit?: string
  /** Show an x-axis label every N bars. */
  tickEvery?: number
}

/** Single-series magnitude over time. One colour — length carries the value. */
export function BarChart({
  title,
  subtitle,
  data,
  variant = 'past',
  height = 132,
  unit = '',
  tickEvery = 7,
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const gridlines = [0, 0.5, 1]
  const active = hover != null ? data[hover] : null

  return (
    <section className="card chart">
      <h3>{title}</h3>
      {subtitle && <div className="tiny muted">{subtitle}</div>}
      <div className="plot" style={{ marginTop: 14 }}>
        <div className="gridlines" style={{ height }}>
          {gridlines.map((g) => (
            <i key={g} style={{ top: `${(1 - g) * 100}%` }} />
          ))}
        </div>
        <div className="bars" style={{ height }} onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => (
            <div
              key={d.label + i}
              className={`bar ${variant === 'forecast' ? 'forecast' : ''} ${d.value === 0 ? 'zero' : ''}`}
              style={{ height: '100%' }}
              onMouseEnter={() => setHover(i)}
            >
              <i style={{ height: d.value === 0 ? 2 : `${Math.max((d.value / max) * 100, 2)}%` }} />
            </div>
          ))}
        </div>
        {active && (
          <div
            className="tooltip"
            style={{
              left: `${((hover! + 0.5) / data.length) * 100}%`,
              top: -4,
            }}
          >
            <div className="t-value">
              {active.value}
              {unit && ` ${unit}`}
            </div>
            <div className="muted">{active.detail ?? active.label}</div>
          </div>
        )}
      </div>
      <div className="axis">
        {data.map((d, i) => (
          <span key={d.label + i}>{showTick(i, data.length, tickEvery) ? shortDay(d.label) : ''}</span>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        Peak {max}
        {unit && ` ${unit}`}
      </div>
    </section>
  )
}

/** Tick every N bars, plus the last one — unless that would crowd its neighbour. */
function showTick(i: number, count: number, every: number): boolean {
  if (i === count - 1) return (count - 1) % every > 2
  return i % every === 0
}

function shortDay(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

export interface Segment {
  label: string
  value: number
  /** A CSS custom property name, e.g. 'var(--c1)'. */
  color: string
}

/**
 * Part-to-whole in one horizontal bar. Segments are direct-labelled when they
 * fit, and a table view is always available — colour never carries meaning alone.
 */
export function StackedBar({
  title,
  subtitle,
  segments,
  countLabel = 'Cards',
}: {
  title: string
  subtitle?: string
  segments: Segment[]
  countLabel?: string
}) {
  const [showTable, setShowTable] = useState(false)
  const total = segments.reduce((sum, s) => sum + s.value, 0)

  return (
    <section className="card chart">
      <div className="row">
        <div className="grow">
          <h3>{title}</h3>
          {subtitle && <div className="tiny muted">{subtitle}</div>}
        </div>
        <button className="btn ghost small" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {total === 0 ? (
        <div className="stacked empty-bar" style={{ marginTop: 14 }} />
      ) : (
        <div className="stacked" style={{ marginTop: 14 }}>
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <i
                key={s.label}
                style={{ background: s.color, width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
        </div>
      )}

      {showTable ? (
        <table className="viz-table">
          <thead>
            <tr>
              <th>{countLabel}</th>
              <th>Count</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td>{s.value}</td>
                <td>{total ? `${Math.round((s.value / total) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="legend">
          {segments.map((s) => (
            <span key={s.label}>
              <i className="swatch" style={{ background: s.color }} />
              {s.label}
              <b style={{ fontWeight: 600 }}>{s.value}</b>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
