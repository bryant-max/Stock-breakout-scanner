import { useEffect, useRef } from 'react'

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

declare global {
  interface Window {
    TradingView?: any
  }
}

function sanitizeSymbol(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9.:]/g, '')
  return cleaned || 'SPY'
}

const LEVEL_CONFIGS = [
  { key: 'entry' as const, color: '#06b6d4', labelFn: (price: number, isShort: boolean) =>
    `${isShort ? 'Short Entry' : 'Buy Entry'} $${price.toFixed(2)}` },
  { key: 'stop' as const, color: '#ef4444', labelFn: (price: number) =>
    `Stop Loss $${price.toFixed(2)}` },
  { key: 'target' as const, color: '#10b981', labelFn: (price: number) =>
    `Target $${price.toFixed(2)}` },
] as const

let widgetCounter = 0

function setupLabel(t: string | null | undefined): string {
  if (t === 'FLAT_TOP') return 'Flat Top Breakout'
  if (t === 'WEDGE')    return 'Wedge Breakout'
  if (t === 'FLAG')     return 'Flag Breakout'
  if (t === 'BASE')     return 'Base Breakout'
  return 'Breakout Level'
}

export function TradingViewWidget({
  symbol,
  interval = 'D',
  theme = 'dark',
  height = 560,
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
  const containerRef = useRef<HTMLDivElement>(null)
  const containerId  = useRef(`tv-chart-${++widgetCounter}`).current
  const timersRef    = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }
  const addTimer    = (t: ReturnType<typeof setTimeout>) => { timersRef.current.push(t) }

  useEffect(() => {
    let mounted  = true
    const container = containerRef.current
    if (!container) return

    const tvSymbol = sanitizeSymbol(symbol)
    const isShort  = direction === 'Short'

    const createWidget = () => {
      if (!mounted || !window.TradingView || !container) return
      container.innerHTML = ''

      const widget = new window.TradingView.widget({
        container_id: containerId,
        width:   container.offsetWidth || 800,
        height,
        symbol:  tvSymbol,
        interval: 'D',
        theme:   theme === 'light' ? 'light' : 'dark',
        timezone: 'Etc/UTC',
        style:   '1',
        locale:  'en',
        toolbar_bg: '#0B1018',
        enable_publishing:  false,
        allow_symbol_change: false,
        hide_side_toolbar:  true,
        withdateranges: true,
        range: '6M',
        studies: ['Volume@tv-basicstudies'],
        support_host: 'https://www.tradingview.com',
      })

      widget.onChartReady(() => {
        if (!mounted) return
        const chart = widget.activeChart()

        // ── EMA studies via createStudy (supports custom colors in free widget) ──
        // Signature: createStudy(name, forceOverlay, lock, inputs, overrides, options)
        const emaStudies = [
          { length: 8,  color: '#f59e0b', width: 1 },  // amber  — EMA 8
          { length: 21, color: '#818cf8', width: 1 },  // indigo — EMA 21
          { length: 50, color: '#38bdf8', width: 2 },  // sky    — EMA 50
        ]
        for (const e of emaStudies) {
          try {
            chart.createStudy(
              'Moving Average Exponential',
              false,   // forceOverlay — false puts it on the main pane
              false,   // lock
              [e.length],   // inputs array: [length]
              {
                'Plot.color':     e.color,
                'Plot.linewidth': e.width,
                'Plot.plottype':  'line',
              }
            )
          } catch (_) { /* ignore if API not available */ }
        }

        // ── Trade level order lines (entry / stop / target) ──
        const levels = { entry, stop, target }
        for (const cfg of LEVEL_CONFIGS) {
          const price = levels[cfg.key]
          if (!price) continue
          try {
            chart.createOrderLine()
              .setPrice(price)
              .setText(cfg.labelFn(price, isShort))
              .setQuantity('')
              .setLineColor(cfg.color)
              .setBodyBackgroundColor(cfg.color)
              .setBodyTextColor('#ffffff')
              .setBodyBorderColor(cfg.color)
              .setLineWidth(2)
          } catch (_) { /* ignore */ }
        }

        // ── Breakout trigger level ──
        if (triggerPrice) {
          try {
            chart.createOrderLine()
              .setPrice(triggerPrice)
              .setText(`⚡ ${setupLabel(setupType)} $${triggerPrice.toFixed(2)}`)
              .setQuantity('')
              .setLineColor('#f97316')
              .setBodyBackgroundColor('#f97316')
              .setBodyTextColor('#ffffff')
              .setBodyBorderColor('#f97316')
              .setLineWidth(2)
          } catch (_) { /* ignore */ }
        }
      })
    }

    addTimer(setTimeout(() => {
      const scriptId = 'tradingview-widget-script'
      const existing = document.getElementById(scriptId) as HTMLScriptElement | null
      if (existing) {
        window.TradingView ? createWidget() : existing.addEventListener('load', createWidget, { once: true })
      } else {
        const s = document.createElement('script')
        s.id    = scriptId
        s.src   = 'https://s3.tradingview.com/tv.js'
        s.async = true
        s.onload = createWidget
        document.head.appendChild(s)
      }
    }, 150))

    return () => {
      mounted = false
      clearTimers()
      addTimer(setTimeout(() => { if (container) container.innerHTML = '' }, 0))
    }
  }, [symbol, interval, theme, containerId, height, entry, stop, target, direction, ema8, ema21, ema50, triggerPrice, setupType])

  return <div id={containerId} ref={containerRef} style={{ height }} className="w-full" />
}
