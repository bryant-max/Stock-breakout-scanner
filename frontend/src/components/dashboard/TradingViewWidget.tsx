import { useEffect, useRef, useCallback } from 'react'

// lightweight-charts loaded via CDN script tag
declare global {
  interface Window {
    LightweightCharts: any
  }
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
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const cleanupRef = useRef<() => void>(() => {})

  const buildChart = useCallback(async () => {
    const container = containerRef.current
    if (!container || !window.LightweightCharts) return

    // Remove existing chart
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

    // Responsive resize
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width })
      }
    })
    ro.observe(container)
    cleanupRef.current = () => { chart.remove(); ro.disconnect() }

    // Fetch OHLCV candles
    let candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = []
    try {
      const res = await fetch(`${API_BASE}/api/chart/candles/${sym}?period=1y&interval=1d`)
      if (res.ok) {
        const data = await res.json()
        candles = data.candles || []
      }
    } catch (_) {}

    if (candles.length === 0) {
      // Fallback: show empty chart with a message
      // Fallback: TradingView iframe when candle data unavailable
      const studies = ['MAExp@tv-basicstudies','MAExp@tv-basicstudies','MAExp@tv-basicstudies','Volume@tv-basicstudies'].join(',')
      const params = new URLSearchParams({symbol: sym, interval: 'D', theme: theme !== 'light' ? 'dark' : 'light', style: '1', locale: 'en', range: '6M', studies, backgroundColor: 'rgba(11,16,24,1)'})
      container.innerHTML = `<iframe src="https://www.tradingview.com/widgetembed/?${params}" style="width:100%;height:100%;border:none;display:block;" allowfullscreen title="${sym} chart"></iframe>`
      return
    }

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))

    // Volume series (histogram at bottom)
    const volSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    volSeries.setData(candles.map(c => ({
      time: c.time,
      value: c.volume ?? 0,
      color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
    })))

    // Compute EMAs from candle closes
    const closes = candles.map(c => c.close)
    const times = candles.map(c => c.time)

    const addEMASeries = (period: number, color: string) => {
      const vals = calcEMA(closes, period)
      const series = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: `EMA ${period}`,
      })
      const data = vals
        .map((v, i) => ({ time: times[i], value: v }))
        .filter(d => !isNaN(d.value))
      series.setData(data)
      return series
    }

    addEMASeries(8, '#f59e0b')   // amber
    addEMASeries(21, '#818cf8')  // indigo
    addEMASeries(50, '#38bdf8')  // sky

    // Price lines — these move with the chart automatically
    const addPriceLine = (price: number, color: string, title: string, style: number) => {
      candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
    }

    const LS = LW.LineStyle
    if (entry != null)       addPriceLine(entry,        '#06b6d4', direction === 'Short' ? 'Short Entry' : 'Buy Entry', LS?.Dashed ?? 1)
    if (stop != null)        addPriceLine(stop,         '#ef4444', 'Stop Loss',                                          LS?.Dashed ?? 1)
    if (target != null)      addPriceLine(target,       '#10b981', 'Target',                                             LS?.Dashed ?? 1)
    if (triggerPrice != null) addPriceLine(triggerPrice, '#f97316', `⚡ ${setupLabel(setupType)}`,                      LS?.Solid  ?? 0)

    // Zoom to show last 6 months by default
    const sixMonthsAgo = Math.floor(Date.now() / 1000) - 180 * 24 * 3600
    const visibleFrom = candles.find(c => c.time >= sixMonthsAgo)?.time ?? candles[0].time
    chart.timeScale().setVisibleRange({ from: visibleFrom, to: candles[candles.length - 1].time })
  }, [sym, theme, height, entry, stop, target, direction, ema8, ema21, ema50, triggerPrice, setupType])

  // Load lightweight-charts from CDN once, then build chart
  useEffect(() => {
    if (window.LightweightCharts) {
      buildChart()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js'
    script.async = true
    script.onload = () => buildChart()
    document.head.appendChild(script)
    return () => { cleanupRef.current() }
  }, [buildChart])

  const entryLabel = direction === 'Short' ? 'Short Entry' : 'Buy Entry'
  const hasTrade = entry != null || stop != null || target != null || triggerPrice != null
  const hasEmas = ema8 != null || ema21 != null || ema50 != null

  return (
    <div className="w-full rounded-xl overflow-hidden border border-white/10" style={{ background: '#0b1018' }}>
      {/* Interactive lightweight-charts canvas */}
      <div ref={containerRef} style={{ width: '100%', height }} />

      {/* Key Levels reference strip below the chart */}
      {(hasTrade || hasEmas) && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
          background: '#0d1520',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>
            Key Levels
          </span>
          {ema8 != null && <Pill color="#f59e0b" bg="rgba(245,158,11,0.12)" label="EMA 8" value={ema8} />}
          {ema21 != null && <Pill color="#818cf8" bg="rgba(129,140,248,0.12)" label="EMA 21" value={ema21} />}
          {ema50 != null && <Pill color="#38bdf8" bg="rgba(56,189,248,0.12)" label="EMA 50" value={ema50} />}
          {(hasEmas && hasTrade) && <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />}
          {triggerPrice != null && <Pill color="#f97316" bg="rgba(249,115,22,0.12)" label={`⚡ ${setupLabel(setupType)}`} value={triggerPrice} />}
          {entry != null && <Pill color="#06b6d4" bg="rgba(6,182,212,0.12)" label={entryLabel} value={entry} />}
          {stop != null && <Pill color="#ef4444" bg="rgba(239,68,68,0.12)" label="Stop Loss" value={stop} />}
          {target != null && <Pill color="#10b981" bg="rgba(16,185,129,0.12)" label="Target" value={target} />}
        </div>
      )}
    </div>
  )
}

function Pill({ color, bg, label, value }: { color: string; bg: string; label: string; value: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: bg, border: `1px solid ${color}66`,
      borderRadius: 6, padding: '3px 8px',
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color, fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontFamily: 'monospace' }}>${value.toFixed(2)}</span>
    </div>
  )
}
