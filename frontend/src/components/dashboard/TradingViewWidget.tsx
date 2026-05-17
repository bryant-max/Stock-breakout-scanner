import { useMemo } from 'react'

type TradingViewWidgetProps = {
  symbol: string
  interval?: string
  theme?: 'dark' | 'light'
  height?: number
  entry?: number | null
  stop?: number | null
  target?: number | null
  direction?: 'Long' | 'Short' | null
  ema8?: number | null
  ema21?: number | null
  ema50?: number | null
  triggerPrice?: number | null
  setupType?: string | null
}

function sanitizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.:]/g, '') || 'SPY'
}

function setupLabel(t: string | null | undefined): string {
  if (t === 'FLAT_TOP') return 'Flat Top Breakout'
  if (t === 'WEDGE') return 'Wedge Breakout'
  if (t === 'FLAG') return 'Flag Breakout'
  if (t === 'BASE') return 'Base Breakout'
  return 'Breakout Level'
}

export function TradingViewWidget({
  symbol,
  theme = 'dark',
  height = 500,
  entry,
  stop,
  target,
  direction,
  ema8,
  ema21,
  ema50,
  triggerPrice,
  setupType,
}: TradingViewWidgetProps) {
  const sym = sanitizeSymbol(symbol)

  // Build TradingView iframe URL — always 1D, EMA 8/21/50 + Volume studies
  const src = useMemo(() => {
    const studies = [
      'MAExp@tv-basicstudies',
      'MAExp@tv-basicstudies',
      'MAExp@tv-basicstudies',
      'Volume@tv-basicstudies',
    ].join(',')

    const params = new URLSearchParams({
      symbol: sym,
      interval: 'D',
      theme: theme === 'light' ? 'light' : 'dark',
      style: '1',
      locale: 'en',
      hide_side_toolbar: '0',
      allow_symbol_change: '0',
      enable_publishing: '0',
      withdateranges: '1',
      range: '6M',
      hide_legend: '0',
      studies,
      timezone: 'Etc/UTC',
      backgroundColor: 'rgba(11,16,24,1)',
      gridColor: 'rgba(255,255,255,0.04)',
    })
    return `https://www.tradingview.com/widgetembed/?${params.toString()}`
  }, [sym, theme])

  const entryLabel = direction === 'Short' ? 'Short Entry' : 'Buy Entry'
  const hasTrade = entry != null || stop != null || target != null || triggerPrice != null
  const hasEmas = ema8 != null || ema21 != null || ema50 != null

  return (
    <div className="w-full rounded-xl overflow-hidden border border-white/10" style={{ background: '#0b1018' }}>
      {/* Clean TradingView chart — no overlay junk */}
      <div style={{ height }}>
        <iframe
          key={sym}
          src={src}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          allowFullScreen
          title={`${sym} chart`}
        />
      </div>

      {/* Key Levels Panel — clean strip below the chart */}
      {(hasTrade || hasEmas) && (
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            background: '#0d1520',
          }}
        >
          {/* Section label */}
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>
            Key Levels
          </span>

          {/* EMA badges */}
          {ema8 != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
              <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>EMA 8</span>
              <span style={{ color: '#fcd34d', fontSize: 11, fontFamily: 'monospace' }}>${ema8.toFixed(2)}</span>
            </div>
          )}
          {ema21 != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#818cf8', flexShrink: 0 }} />
              <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>EMA 21</span>
              <span style={{ color: '#a5b4fc', fontSize: 11, fontFamily: 'monospace' }}>${ema21.toFixed(2)}</span>
            </div>
          )}
          {ema50 != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', flexShrink: 0 }} />
              <span style={{ color: '#38bdf8', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>EMA 50</span>
              <span style={{ color: '#7dd3fc', fontSize: 11, fontFamily: 'monospace' }}>${ema50.toFixed(2)}</span>
            </div>
          )}

          {/* Divider between EMAs and trade levels */}
          {hasEmas && hasTrade && (
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
          )}

          {/* Trigger / Breakout level */}
          {triggerPrice != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <span style={{ fontSize: 11 }}>⚡</span>
              <span style={{ color: '#f97316', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{setupLabel(setupType)}</span>
              <span style={{ color: '#fdba74', fontSize: 11, fontFamily: 'monospace' }}>${triggerPrice.toFixed(2)}</span>
            </div>
          )}

          {/* Entry */}
          {entry != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <span style={{ color: '#06b6d4', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{entryLabel}</span>
              <span style={{ color: '#67e8f9', fontSize: 11, fontFamily: 'monospace' }}>${entry.toFixed(2)}</span>
            </div>
          )}

          {/* Stop Loss */}
          {stop != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>Stop Loss</span>
              <span style={{ color: '#fca5a5', fontSize: 11, fontFamily: 'monospace' }}>${stop.toFixed(2)}</span>
            </div>
          )}

          {/* Target */}
          {target != null && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <span style={{ color: '#10b981', fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>Target</span>
              <span style={{ color: '#6ee7b7', fontSize: 11, fontFamily: 'monospace' }}>${target.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
