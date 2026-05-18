import { useEffect, useRef, useCallback, useState } from 'react'

// lightweight-charts loaded via CDN script tag
declare global {
  interface Window { LightweightCharts: any }
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'https://stock-breakout-scanner-production-b5c4.up.railway.app'

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

// Timeframe definitions — candles to show in visible range
const TIMEFRAMES = [
  { label: '1D',  bars: 1    },
  { label: '3D',  bars: 3    },
  { label: '1W',  bars: 5    },
  { label: '1M',  bars: 22   },
  { label: '3M',  bars: 66   },
] as const
type TFLabel = typeof TIMEFRAMES[number]['label']

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

/** Compute EMA values from close prices */
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const emas: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { emas.push(NaN); continue }
    if (i === period - 1) { emas.push(closes.slice(0, period).reduce((a, b) => a + b, 0) / period); continue }
    emas.push(closes[i] * k + emas[i - 1] * (1 - k))
  }
  return emas
}

export function TradingViewWidget({
  symbol, theme = 'dark', height = 500,
  entry, stop, target, direction,
  ema8, ema21, ema50, triggerPrice, setupType,
}: TradingViewWidgetProps) {
  const sym = sanitizeSymbol(symbol)
  const containerRef  = useRef<HTMLDivElement>(null)
  const chartRef      = useRef<any>(null)
  const cleanupRef    = useRef<() => void>(() => {})
  const candlesRef    = useRef<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]>([])
  const [activeTF, setActiveTF] = useState<TFLabel>('1D')

  // Apply a visible range on the chart based on bars count
  const applyRange = useCallback((bars: number) => {
    const chart = chartRef.current
    const candles = candlesRef.current
    if (!chart || candles.length === 0) return
    const last = candles[candles.length - 1].time
    // Show 'bars' worth of daily candles. Each bar = ~1 trading day.
    // Add ~20% right margin so latest candle isn't stuck at the edge.
    const margin = Math.ceil(bars * 0.2)
    const fromIdx = Math.max(0, candles.length - bars - margin)
    const from = candles[fromIdx].time
    // right side: push slightly past last candle for breathing room
    const dayMs = 86400
    const to = last + dayMs * margin
    chart.timeScale().setVisibleRange({ from, to })
  }, [])

  const buildChart = useCallback(async () => {
    const container = containerRef.current
    if (!container || !window.LightweightCharts) return

    cleanupRef.current()
    container.innerHTML = ''

    const LW = window.LightweightCharts
    const isDark = theme !== 'light'

    const chart = LW.createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: 'solid', color: isDark ? '#0b1018' : '#ffffff' },
        textColor: isDark ? 'rgba(255,255,255,0.7)' : '#333',
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' },
        horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' },
      },
      crosshair: { mode: LW.CrosshairMode.Normal },
      rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
      timeScale: {
        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        timeVisible: false,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    })
    chartRef.current = chart

    const ro = new ResizeObserver(entries => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width })
    })
    ro.observe(container)
    cleanupRef.current = () => { chart.remove(); ro.disconnect() }

    // Fetch OHLCV candles (1y of daily data)
    let candles: typeof candlesRef.current = []
    try {
      const res = await fetch(`${API_BASE}/api/chart/candles/${sym}?period=1y&interval=1d`)
      if (res.ok) {
        const data = await res.json()
        candles = data.candles || []
      }
    } catch (_) {}

    if (candles.length === 0) {
      // Fallback: TradingView iframe
      const studies = ['MAExp@tv-basicstudies','MAExp@tv-basicstudies','MAExp@tv-basicstudies','Volume@tv-basicstudies'].join(',')
      const params = new URLSearchParams({ symbol: sym, interval: 'D', theme: isDark ? 'dark' : 'light', style: '1', locale: 'en', range: '3M', studies, backgroundColor: 'rgba(11,16,24,1)' })
      container.innerHTML = `<iframe src="https://www.tradingview.com/widgetembed/?${params}" style="width:100%;height:100%;border:none;display:block;" allowfullscreen title="${sym} chart"></iframe>`
      return
    }

    candlesRef.current = candles

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))

    // Volume histogram
    const volSeries = chart.addHistogramSeries({
      color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    volSeries.setData(candles.map(c => ({
      time: c.time, value: c.volume ?? 0,
      color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
    })))

    // EMA lines
    const closes = candles.map(c => c.close)
    const times  = candles.map(c => c.time)
    const addEMASeries = (period: number, color: string) => {
      const vals = calcEMA(closes, period)
      const series = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: `EMA ${period}` })
      series.setData(vals.map((v, i) => ({ time: times[i], value: v })).filter(d => !isNaN(d.value)))
    }
    addEMASeries(8,  '#f59e0b')
    addEMASeries(21, '#818cf8')
    addEMASeries(50, '#38bdf8')

    // Native price lines (move with zoom/pan)
    const LS = LW.LineStyle
    const addLine = (price: number, color: string, title: string, style: number) =>
      candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
    if (entry       != null) addLine(entry,        '#06b6d4', direction === 'Short' ? 'Short Entry' : 'Buy Entry', LS?.Dashed ?? 1)
    if (stop        != null) addLine(stop,         '#ef4444', 'Stop Loss',                                         LS?.Dashed ?? 1)
    if (target      != null) addLine(target,       '#10b981', 'Target',                                            LS?.Dashed ?? 1)
    if (triggerPrice != null) addLine(triggerPrice, '#f97316', `⚡ ${setupLabel(setupType)}`,                    LS?.Solid  ?? 0)

    // Default view: 1D (last ~22 bars — one trading month)
    // activeTF state is '1D' on first render, so we always start on 1D
    const tf = TIMEFRAMES.find(t => t.label === '1D')!
    const margin = Math.ceil(tf.bars * 0.2)
    const fromIdx = Math.max(0, candles.length - tf.bars - margin)
    const dayMs = 86400
    chart.timeScale().setVisibleRange({
      from: candles[fromIdx].time,
      to:   candles[candles.length - 1].time + dayMs * margin,
    })
  }, [sym, theme, height, entry, stop, target, direction, triggerPrice, setupType])

  // Load lightweight-charts CDN, then build
  useEffect(() => {
    if (window.LightweightCharts) { buildChart(); return }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js'
    script.async = true
    script.onload = () => buildChart()
    document.head.appendChild(script)
    return () => { cleanupRef.current() }
  }, [buildChart])

  // When user clicks a timeframe button, apply the range
  const handleTF = (tf: typeof TIMEFRAMES[number]) => {
    setActiveTF(tf.label)
    applyRange(tf.bars)
  }

  const entryLabel = direction === 'Short' ? 'Short Entry' : 'Buy Entry'
  const hasTrade   = entry != null || stop != null || target != null || triggerPrice != null
  const hasEmas    = ema8 != null || ema21 != null || ema50 != null

  return (
    <div className="w-full rounded-xl overflow-hidden border border-white/10" style={{ background: '#0b1018' }}>
      {/* Timeframe selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.label}
            onClick={() => handleTF(tf)}
            style={{
              padding: '3px 10px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'monospace',
              border: activeTF === tf.label ? '1px solid rgba(99,179,237,0.5)' : '1px solid rgba(255,255,255,0.08)',
              background: activeTF === tf.label ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
              color: activeTF === tf.label ? '#38bdf8' : 'rgba(255,255,255,0.45)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {tf.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
          {sym} · Daily
        </span>
      </div>

      {/* Chart canvas */}
      <div ref={containerRef} style={{ width: '100%', height }} />

      {/* Key Levels reference strip */}
      {(hasTrade || hasEmas) && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '8px 14px',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
          background: '#0d1520',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>
            Key Levels
          </span>
          {ema8  != null && <Pill color="#f59e0b" bg="rgba(245,158,11,0.12)"  label="EMA 8"  value={ema8}  />}
          {ema21 != null && <Pill color="#818cf8" bg="rgba(129,140,248,0.12)" label="EMA 21" value={ema21} />}
          {ema50 != null && <Pill color="#38bdf8" bg="rgba(56,189,248,0.12)"  label="EMA 50" value={ema50} />}
          {(hasEmas && hasTrade) && <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />}
          {triggerPrice != null && <Pill color="#f97316" bg="rgba(249,115,22,0.12)"  label={`⚡ ${setupLabel(setupType)}`} value={triggerPrice} />}
          {entry != null        && <Pill color="#06b6d4" bg="rgba(6,182,212,0.12)"   label={entryLabel}  value={entry}  />}
          {stop  != null        && <Pill color="#ef4444" bg="rgba(239,68,68,0.12)"   label="Stop Loss"   value={stop}   />}
          {target != null       && <Pill color="#10b981" bg="rgba(16,185,129,0.12)"  label="Target"      value={target} />}
        </div>
      )}
    </div>
  )
}

function Pill({ color, bg, label, value }: { color: string; bg: string; label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: bg, border: `1px solid ${color}66`, borderRadius: 6, padding: '3px 8px' }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color, fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontFamily: 'monospace' }}>${value.toFixed(2)}</span>
    </div>
  )
}
