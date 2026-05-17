import { useEffect, useRef, useMemo } from 'react'

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
  if (t === 'WEDGE')    return 'Wedge Breakout'
  if (t === 'FLAG')     return 'Flag Breakout'
  if (t === 'BASE')     return 'Base Breakout'
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

  // Build the TradingView Advanced Chart embed URL
  // Studies: EMA 8 (amber), EMA 21 (indigo), EMA 50 (sky) + Volume
  // Locked to 1D interval
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
      hide_side_toolbar: '1',
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

  // Price levels to draw as overlay labels beside the chart
  const levels = [
    entry      != null ? { price: entry,        color: '#06b6d4', label: direction === 'Short' ? 'Short Entry' : 'Buy Entry', side: 'right' } : null,
    stop       != null ? { price: stop,         color: '#ef4444', label: 'Stop Loss',                                          side: 'right' } : null,
    target     != null ? { price: target,       color: '#10b981', label: 'Target',                                            side: 'right' } : null,
    triggerPrice != null ? { price: triggerPrice, color: '#f97316', label: `⚡ ${setupLabel(setupType)}`,                       side: 'right' } : null,
    ema8       != null ? { price: ema8,         color: '#f59e0b', label: 'EMA 8',                                             side: 'left'  } : null,
    ema21      != null ? { price: ema21,        color: '#818cf8', label: 'EMA 21',                                            side: 'left'  } : null,
    ema50      != null ? { price: ema50,        color: '#38bdf8', label: 'EMA 50',                                            side: 'left'  } : null,
  ].filter(Boolean) as { price: number; color: string; label: string; side: string }[]

  // All price levels to determine scale for vertical positioning
  const allPrices = levels.map(l => l.price)
  const minPrice = allPrices.length ? Math.min(...allPrices) * 0.985 : 0
  const maxPrice = allPrices.length ? Math.max(...allPrices) * 1.015 : 1

  const priceToPercent = (p: number) => {
    if (maxPrice === minPrice) return 50
    return 100 - ((p - minPrice) / (maxPrice - minPrice)) * 100
  }

  return (
    <div className="relative w-full" style={{ height }}>
      {/* TradingView iframe — always 1D, EMA studies baked in */}
      <iframe
        key={sym}
        src={src}
        style={{ width: '100%', height: '100%', border: 'none' }}
        allowFullScreen
        title={`${sym} chart`}
      />

      {/* Price level overlay — right side panel */}
      {levels.length > 0 && (
        <div
          className="absolute top-0 right-0 bottom-0 pointer-events-none"
          style={{ width: 180, zIndex: 10 }}
        >
          {levels.filter(l => l.side === 'right').map((l, i) => (
            <div
              key={i}
              className="absolute right-1 flex items-center gap-1.5"
              style={{ top: `${priceToPercent(l.price)}%`, transform: 'translateY(-50%)' }}
            >
              <div style={{ width: 28, height: 2, backgroundColor: l.color, flexShrink: 0 }} />
              <div
                style={{
                  backgroundColor: l.color,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                }}
              >
                {l.label} ${l.price.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* EMA labels — left side panel */}
      {levels.filter(l => l.side === 'left').length > 0 && (
        <div
          className="absolute top-0 left-0 bottom-0 pointer-events-none"
          style={{ width: 140, zIndex: 10 }}
        >
          {levels.filter(l => l.side === 'left').map((l, i) => (
            <div
              key={i}
              className="absolute left-1 flex items-center gap-1.5"
              style={{ top: `${priceToPercent(l.price)}%`, transform: 'translateY(-50%)' }}
            >
              <div
                style={{
                  backgroundColor: l.color,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 5px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                }}
              >
                {l.label} ${l.price.toFixed(2)}
              </div>
              <div style={{ width: 20, height: 2, backgroundColor: l.color, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
