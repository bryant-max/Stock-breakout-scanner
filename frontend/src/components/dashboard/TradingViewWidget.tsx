import { useEffect, useRef, useState } from 'react'

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

// Map our interval labels to TradingView interval codes
const TV_INTERVAL_MAP: Record<string, string> = {
  '5m':  '5',
  '15m': '15',
  '30m': '30',
  '1h':  '60',
  '2h':  '120',
  '4h':  '240',
  '1D':  'D',
}

const INTERVAL_LABELS = ['5m', '15m', '30m', '1h', '2h', '4h', '1D'] as const
type IVLabel = typeof INTERVAL_LABELS[number]

function sanitizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.:]/g, '') || 'SPY'
}

function setupLabel(t: string | null | undefined): string {
  if (t === 'FLAT_TOP') return 'Flat Top'
  if (t === 'WEDGE')    return 'Wedge'
  if (t === 'FLAG')     return 'Flag'
  if (t === 'BASE')     return 'Base'
  return 'Breakout'
}

export function TradingViewWidget({
  symbol, theme = 'dark', height = 500,
  entry, stop, target, direction,
  ema8, ema21, ema50, triggerPrice, setupType,
}: TradingViewWidgetProps) {
  const sym = sanitizeSymbol(symbol)
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef    = useRef<any>(null)
  const [activeIV, setActiveIV] = useState<IVLabel>('1D')

  const buildWidget = (ivLabel: IVLabel) => {
    const container = containerRef.current
    if (!container || !(window as any).TradingView) return

    // Destroy existing widget
    if (widgetRef.current) {
      try { widgetRef.current.remove() } catch (_) {}
      widgetRef.current = null
    }
    container.innerHTML = ''

    const tvInterval = TV_INTERVAL_MAP[ivLabel] ?? 'D'
    const isDark = theme !== 'light'

    // Build studies list — EMA 8, 21, 50 with our colors
    const studies = [
      {
        id: 'MAExp@tv-basicstudies',
        inputs: { length: 8 },
        override: { 'Plot.color': '#f59e0b', 'Plot.linewidth': 1 },
      },
      {
        id: 'MAExp@tv-basicstudies',
        inputs: { length: 21 },
        override: { 'Plot.color': '#818cf8', 'Plot.linewidth': 1 },
      },
      {
        id: 'MAExp@tv-basicstudies',
        inputs: { length: 50 },
        override: { 'Plot.color': '#38bdf8', 'Plot.linewidth': 1 },
      },
    ]

    const widget = new (window as any).TradingView.widget({
      container_id: container.id,
      symbol: `NASDAQ:${sym}`,
      interval: tvInterval,
      timezone: 'America/New_York',
      theme: isDark ? 'dark' : 'light',
      style: '1',              // Candles
      locale: 'en',
      toolbar_bg: isDark ? '#0b1018' : '#ffffff',
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      withdateranges: false,
      show_popup_button: false,
      height,
      width: '100%',
      // Show countdown timer to candle close
      countdown_on_price_line: true,
      // Disable drawing tools bar
      studies_overrides: {
        'volume.volume.color.0': 'rgba(239,83,80,0.4)',
        'volume.volume.color.1': 'rgba(38,166,154,0.4)',
        'volume.volume ma.visible': false,
      },
      overrides: {
        'mainSeriesProperties.candleStyle.upColor':   '#26a69a',
        'mainSeriesProperties.candleStyle.downColor': '#ef5350',
        'mainSeriesProperties.candleStyle.borderUpColor':   '#26a69a',
        'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
        'mainSeriesProperties.candleStyle.wickUpColor':   '#26a69a',
        'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
        'paneProperties.background':          isDark ? '#0b1018' : '#ffffff',
        'paneProperties.backgroundType':      'solid',
        'paneProperties.gridLinesMode':       'both',
        'paneProperties.vertGridProperties.color': isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
        'paneProperties.horzGridProperties.color': isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
        'scalesProperties.textColor': isDark ? 'rgba(255,255,255,0.6)' : '#333',
        'scalesProperties.lineColor': isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      },
      studies,
      // After widget is ready, add price lines for key levels
      onChartReady: () => {
        const chart = widget.activeChart()
        if (!chart) return

        // Add price lines for entry, stop, target, breakout
        const addLine = (price: number, color: string, title: string, linestyle: number) => {
          try {
            chart.createShape(
              { time: 0, price },
              {
                shape: 'horizontal_line',
                lock: true,
                disableSelection: true,
                disableSave: true,
                disableUndo: true,
                text: title,
                overrides: {
                  linecolor: color,
                  linestyle,
                  linewidth: 1,
                  showLabel: true,
                  textcolor: color,
                  fontsize: 11,
                  bold: true,
                  extendLeft: true,
                  extendRight: true,
                  horzLabelsAlign: 'right',
                  vertLabelsAlign: 'middle',
                },
              }
            )
          } catch (_) {}
        }

        // linestyle: 0=solid, 1=dotted, 2=dashed
        if (entry       != null) addLine(entry,        '#06b6d4', direction === 'Short' ? 'Short Entry' : 'Buy Entry',      2)
        if (stop        != null) addLine(stop,         '#ef4444', 'Stop Loss',                                              2)
        if (target      != null) addLine(target,       '#10b981', 'Target',                                                 2)
        if (triggerPrice != null) addLine(triggerPrice, '#f97316', `⚡ ${setupLabel(setupType)}`,                           0)
      },
    })

    widgetRef.current = widget
  }

  // Load TradingView library then build widget
  useEffect(() => {
    const containerId = `tv_${sym}_${Date.now()}`
    if (containerRef.current) containerRef.current.id = containerId

    const load = () => buildWidget(activeIV)

    if ((window as any).TradingView) {
      load()
    } else {
      const script = document.createElement('script')
      script.src   = 'https://s3.tradingview.com/tv.js'
      script.async = true
      script.onload = load
      document.head.appendChild(script)
    }

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove() } catch (_) {}
        widgetRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym])

  const handleIV = (ivLabel: IVLabel) => {
    setActiveIV(ivLabel)
    buildWidget(ivLabel)
  }

  const entryLabel = direction === 'Short' ? 'Short Entry' : 'Buy Entry'
  const hasTrade   = entry != null || stop != null || target != null || triggerPrice != null
  const hasEmas    = ema8 != null || ema21 != null || ema50 != null

  return (
    <div className="w-full rounded-xl overflow-hidden border border-white/10" style={{ background: '#0b1018' }}>
      {/* Interval selector */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexWrap: 'wrap',
        background: '#0b1018',
      }}>
        {INTERVAL_LABELS.map(iv => {
          const isActive   = activeIV === iv
          const isIntraday = iv !== '1D'
          return (
            <button
              key={iv}
              onClick={() => handleIV(iv)}
              style={{
                padding: '3px 10px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'monospace',
                border: isActive
                  ? '1px solid rgba(99,179,237,0.5)'
                  : isIntraday
                    ? '1px solid rgba(255,255,255,0.06)'
                    : '1px solid rgba(255,255,255,0.08)',
                background: isActive ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
                color: isActive
                  ? '#38bdf8'
                  : isIntraday ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {iv}
            </button>
          )
        })}
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 3px' }} />
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
          {sym} · {activeIV} · LIVE
        </span>
      </div>

      {/* TradingView chart container */}
      <div ref={containerRef} style={{ width: '100%', height }} />

      {/* Key Levels strip */}
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
          {entry  != null && <Pill color="#06b6d4" bg="rgba(6,182,212,0.12)"   label={entryLabel} value={entry}  />}
          {stop   != null && <Pill color="#ef4444" bg="rgba(239,68,68,0.12)"   label="Stop Loss"  value={stop}   />}
          {target != null && <Pill color="#10b981" bg="rgba(16,185,129,0.12)"  label="Target"     value={target} />}
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
