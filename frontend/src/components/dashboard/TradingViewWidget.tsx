import { useEffect, useRef, useCallback, useState } from 'react'

// lightweight-charts v4 via CDN
declare global { interface Window { LightweightCharts: any } }

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

const INTERVALS = [
  { label: '5m',  interval: '5m',  period: '5d',  timeVisible: true,  pollMs: 5_000 },
  { label: '15m', interval: '15m', period: '10d', timeVisible: true,  pollMs: 5_000 },
  { label: '30m', interval: '30m', period: '14d', timeVisible: true,  pollMs: 5_000 },
  { label: '1h',  interval: '1h',  period: '1mo', timeVisible: true,  pollMs: 5_000 },
  { label: '2h',  interval: '2h',  period: '1mo', timeVisible: true,  pollMs: 5_000 },
  { label: '4h',  interval: '4h',  period: '3mo', timeVisible: true,  pollMs: 5_000 },
  { label: '1D',  interval: '1d',  period: '1y',  timeVisible: false, pollMs: 15_000 },
] as const
type IVLabel = typeof INTERVALS[number]['label']

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
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1); const emas: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { emas.push(NaN); continue }
    if (i === period - 1) { emas.push(closes.slice(0, period).reduce((a, b) => a + b, 0) / period); continue }
    emas.push(closes[i] * k + emas[i - 1] * (1 - k))
  }
  return emas
}

/** Fetch current live price snapshot from backend (bypasses candle cache, 5s TTL on server) */
async function fetchLiveSnapshot(sym: string): Promise<{ price: number; open: number; high: number; low: number; volume: number; change_pct: number | null } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/chart/live-price/${sym}?_t=${Date.now()}`)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

export function TradingViewWidget({
  symbol, theme = 'dark', height = 500,
  entry, stop, target, direction,
  ema8, ema21, ema50, triggerPrice, setupType,
}: TradingViewWidgetProps) {
  const sym = sanitizeSymbol(symbol)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const cleanupRef = useRef<() => void>(() => {})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const candleSeriesRef = useRef<any>(null)
  const volSeriesRef = useRef<any>(null)
  const ema8Ref = useRef<any>(null)
  const ema21Ref = useRef<any>(null)
  const ema50Ref = useRef<any>(null)
  // Store the last full candle data so we can update the last bar
  const lastCandlesRef = useRef<any[]>([])

  const [activeIV, setActiveIV] = useState<IVLabel>('1D')
  const [isLoading, setIsLoading] = useState(false)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [changePct, setChangePct] = useState<number | null>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  /**
   * Live tick update: fetch snapshot from /api/chart/live-price and update
   * ONLY the last candle bar in-place. This runs every 5 seconds and gives
   * a real-time price tick without rebuilding the whole chart.
   */
  const tickUpdate = useCallback(async () => {
    const cs = candleSeriesRef.current
    if (!cs || !lastCandlesRef.current.length) return

    const snap = await fetchLiveSnapshot(sym)
    if (!snap || !snap.price) return

    const candles = lastCandlesRef.current
    const last = candles[candles.length - 1]
    if (!last) return

    // Build updated last bar with live price
    const updatedBar = {
      time: last.time,
      open: last.open,
      high: Math.max(last.high, snap.high ?? snap.price, snap.price),
      low: Math.min(last.low, snap.low ?? snap.price, snap.price),
      close: snap.price,
    }

    // Use update() for the last bar — lightweight-charts handles this efficiently
    try {
      cs.update(updatedBar)
      // Update volume series last bar too
      const vs = volSeriesRef.current
      if (vs) {
        vs.update({
          time: last.time,
          value: snap.volume ?? last.volume ?? 0,
          color: snap.price >= last.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
        })
      }
    } catch { /* silent — bar may be out of order during pre/post market */ }

    setLivePrice(snap.price)
    setChangePct(snap.change_pct ?? null)
  }, [sym])

  /** Full candle refresh: re-fetch all candles and rebuild series data (keeps price lines intact) */
  const softRefresh = useCallback(async (ivLabel: IVLabel) => {
    const cs = candleSeriesRef.current
    if (!cs) return
    const ivDef = INTERVALS.find(i => i.label === ivLabel)!
    try {
      const res = await fetch(`${API_BASE}/api/chart/candles/${sym}?period=${ivDef.period}&interval=${ivDef.interval}&_t=${Date.now()}`)
      if (!res.ok) return
      const data = await res.json()
      const candles: any[] = data.candles || []
      if (!candles.length) return

      lastCandlesRef.current = candles

      cs.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))
      const vs = volSeriesRef.current
      if (vs) vs.setData(candles.map(c => ({ time: c.time, value: c.volume ?? 0, color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)' })))

      const closes = candles.map(c => c.close)
      const times = candles.map(c => c.time)
      const updateEMA = (series: any, period: number) => {
        if (!series) return
        const vals = calcEMA(closes, period)
        series.setData(vals.map((v, i) => ({ time: times[i], value: v })).filter((d: any) => !isNaN(d.value)))
      }
      updateEMA(ema8Ref.current, 8)
      updateEMA(ema21Ref.current, 21)
      updateEMA(ema50Ref.current, 50)

      // If the backend already injected live price in last candle, show it
      if (data.live_price) {
        setLivePrice(data.live_price)
      } else {
        setLivePrice(candles[candles.length - 1].close)
      }
    } catch { /* silent */ }
  }, [sym])

  const buildChart = useCallback(async (ivLabel: IVLabel) => {
    const container = containerRef.current
    if (!container || !window.LightweightCharts) return
    const ivDef = INTERVALS.find(i => i.label === ivLabel)!

    stopPoll()
    setIsLoading(true)
    cleanupRef.current(); container.innerHTML = ''
    chartRef.current = null; candleSeriesRef.current = null; volSeriesRef.current = null
    ema8Ref.current = null; ema21Ref.current = null; ema50Ref.current = null
    lastCandlesRef.current = []

    const LW = window.LightweightCharts; const isDark = theme !== 'light'
    const chart = LW.createChart(container, {
      width: container.clientWidth, height,
      layout: { background: { type: 'solid', color: isDark ? '#0b1018' : '#ffffff' }, textColor: isDark ? 'rgba(255,255,255,0.7)' : '#333', fontSize: 11, fontFamily: 'Inter,system-ui,sans-serif' },
      grid: { vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' }, horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' } },
      crosshair: { mode: LW.CrosshairMode.Normal },
      rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
      timeScale: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', timeVisible: ivDef.timeVisible, secondsVisible: false, rightOffset: 3, barSpacing: ivDef.interval === '1d' ? 8 : 6, minBarSpacing: 1 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    })
    chartRef.current = chart
    const ro = new ResizeObserver(entries => { for (const e of entries) chart.applyOptions({ width: e.contentRect.width }) })
    ro.observe(container)
    cleanupRef.current = () => { chart.remove(); ro.disconnect() }

    // Fetch candles + live snapshot concurrently
    let candles: any[] = []
    let livePriceFromServer: number | null = null
    try {
      const [candleRes, snapData] = await Promise.all([
        fetch(`${API_BASE}/api/chart/candles/${sym}?period=${ivDef.period}&interval=${ivDef.interval}`),
        fetchLiveSnapshot(sym),
      ])
      if (candleRes.ok) {
        const data = await candleRes.json()
        candles = data.candles || []
        livePriceFromServer = data.live_price ?? null
        // If server already patched last candle, great. If we also got a snap, use that (fresher)
        if (snapData?.price && candles.length) {
          livePriceFromServer = snapData.price
          const last = candles[candles.length - 1]
          candles[candles.length - 1] = {
            ...last,
            close: snapData.price,
            high: Math.max(last.high, snapData.high ?? snapData.price, snapData.price),
            low: Math.min(last.low, snapData.low ?? snapData.price, snapData.price),
          }
        }
      }
    } catch { /* silent */ }

    setIsLoading(false)

    if (!candles.length) {
      // Fallback iframe
      const p = new URLSearchParams({ symbol: sym, interval: 'D', theme: isDark ? 'dark' : 'light', style: '1', locale: 'en', range: '3M', backgroundColor: 'rgba(11,16,24,1)' })
      container.innerHTML = `<iframe src="https://www.tradingview.com/widgetembed/?${p}" style="width:100%;height:100%;border:none;display:block;" allowfullscreen title="${sym} chart"></iframe>`
      return
    }

    lastCandlesRef.current = candles

    // ── Candlestick series ──
    const candleSeries = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' })
    candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))
    candleSeriesRef.current = candleSeries

    // ── Volume ──
    const volSeries = chart.addHistogramSeries({ color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    volSeries.setData(candles.map(c => ({ time: c.time, value: c.volume ?? 0, color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)' })))
    volSeriesRef.current = volSeries

    // ── EMA lines ──
    const closes = candles.map(c => c.close); const times = candles.map(c => c.time)
    const addEMASeries = (period: number, color: string, ref: React.MutableRefObject<any>) => {
      const vals = calcEMA(closes, period)
      const series = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: `EMA ${period}` })
      series.setData(vals.map((v, i) => ({ time: times[i], value: v })).filter((d: any) => !isNaN(d.value)))
      ref.current = series
    }
    addEMASeries(8, '#f59e0b', ema8Ref)   // amber
    addEMASeries(21, '#818cf8', ema21Ref) // indigo
    addEMASeries(50, '#38bdf8', ema50Ref) // sky

    // ── Key level price lines (always shown on all timeframes) ──
    const LS = LW.LineStyle
    const addLine = (price: number, color: string, title: string, style: number) =>
      candleSeries.createPriceLine({ price, color, lineWidth: 1.5, lineStyle: style, axisLabelVisible: true, title })

    if (entry != null) addLine(entry, '#06b6d4', direction === 'Short' ? 'Short Entry' : 'Buy Entry', LS?.Dashed ?? 1)
    if (stop != null) addLine(stop, '#ef4444', 'Stop Loss', LS?.Dashed ?? 1)
    if (target != null) addLine(target, '#10b981', 'Target', LS?.Dashed ?? 1)
    if (triggerPrice != null) addLine(triggerPrice, '#f97316', `⚡ ${setupLabel(setupType)}`, LS?.Solid ?? 0)

    chart.timeScale().fitContent()
    setLivePrice(livePriceFromServer ?? candles[candles.length - 1].close)

    // ── Start polling: live tick every 5s, full candle refresh per interval ──
    // Tick poll (5s): updates only last bar from live-price endpoint
    // Candle poll (interval-specific): refreshes all candle data
    let candlePollCount = 0
    const candlePollEvery = Math.round(ivDef.pollMs / 5_000) // how many ticks per candle refresh

    pollRef.current = setInterval(async () => {
      candlePollCount++
      // Always do a live tick update
      await tickUpdate()
      // Periodically do a full candle refresh (to pick up new completed bars)
      if (candlePollCount >= candlePollEvery) {
        candlePollCount = 0
        await softRefresh(ivLabel)
      }
    }, 5_000)
  }, [sym, theme, height, entry, stop, target, direction, triggerPrice, setupType, stopPoll, tickUpdate, softRefresh])

  useEffect(() => {
    if (window.LightweightCharts) { buildChart('1D'); return }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js'
    script.async = true; script.onload = () => buildChart('1D')
    document.head.appendChild(script)
    return () => { cleanupRef.current(); stopPoll() }
  }, [buildChart, stopPoll])

  const handleIV = (ivLabel: IVLabel) => { setActiveIV(ivLabel); buildChart(ivLabel) }

  const entryLabel = direction === 'Short' ? 'Short Entry' : 'Buy Entry'
  const hasTrade = entry != null || stop != null || target != null || triggerPrice != null
  const hasEmas = ema8 != null || ema21 != null || ema50 != null
  const activeIVDef = INTERVALS.find(i => i.label === activeIV)!

  return (
    <div className="w-full rounded-xl overflow-hidden border border-white/10" style={{ background: '#0b1018' }}>
      {/* Interval selector + live price */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
        {INTERVALS.map(iv => {
          const isActive = activeIV === iv.label; const isIntraday = iv.interval !== '1d'
          return (
            <button key={iv.label} onClick={() => handleIV(iv.label)} style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
              border: isActive ? '1px solid rgba(99,179,237,0.5)' : isIntraday ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(255,255,255,0.08)',
              background: isActive ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
              color: isActive ? '#38bdf8' : isIntraday ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.45)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{iv.label}</button>
          )
        })}
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 3px' }} />
        {/* Live price badge */}
        {livePrice != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'monospace', color: '#22c55e', fontWeight: 700 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 4px #22c55e', display: 'inline-block', animation: 'pulse-green 1.5s ease-in-out infinite' }} />
            ${livePrice.toFixed(2)}
            {changePct != null && (
              <span style={{ fontSize: 10, color: changePct >= 0 ? '#22c55e' : '#ef4444', marginLeft: 2 }}>
                {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
          {sym} · {activeIVDef.label} · LIVE
          {isLoading && ' · loading…'}
        </span>
      </div>

      <style>{`@keyframes pulse-green { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

      {/* Chart */}
      <div ref={containerRef} style={{ width: '100%', height }} />

      {/* Key Levels strip */}
      {(hasTrade || hasEmas) && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 14px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, background: '#0d1520' }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>Key Levels</span>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: bg, border: `1px solid ${color}66`, borderRadius: 6, padding: '3px 8px' }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color, fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontFamily: 'monospace' }}>${value.toFixed(2)}</span>
    </div>
  )
}
