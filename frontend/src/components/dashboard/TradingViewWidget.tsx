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
  const containerId = useRef(`tv-chart-${++widgetCounter}`).current
  // Track all pending timeouts so cleanup is complete
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  const addTimer = (t: ReturnType<typeof setTimeout>) => {
    timersRef.current.push(t)
  }

  useEffect(() => {
    let mounted = true
    const container = containerRef.current
    if (!container) return

    const tvSymbol = sanitizeSymbol(symbol)

    const createWidget = () => {
      if (!mounted || !window.TradingView || !container) return
      container.innerHTML = ''

      const widget = new window.TradingView.widget({
        container_id: containerId,
        width: container.offsetWidth || 800,
        height,
        symbol: tvSymbol,
        interval: 'D',
        theme: theme === 'light' ? 'light' : 'dark',
        timezone: 'Etc/UTC',
        style: '1',
        locale: 'en',
        toolbar_bg: '#0B1018',
        enable_publishing: false,
        allow_symbol_change: false,
        hide_side_toolbar: true,
        withdateranges: true,
        range: '6M',
        studies: ['Volume@tv-basicstudies'],
        support_host: 'https://www.tradingview.com',
      })

      widget.onChartReady(() => {
        if (!mounted) return
        const chart = widget.activeChart()
        const isShort = direction === 'Short'

        // --- Trade levels (entry / stop / target) ---
        const levels = { entry, stop, target }
        for (const cfg of LEVEL_CONFIGS) {
          const price = levels[cfg.key]
          if (!price) continue
          chart.createOrderLine()
            .setPrice(price)
            .setText(cfg.labelFn(price, isShort))
            .setQuantity('')
            .setLineColor(cfg.color)
            .setBodyBackgroundColor(cfg.color)
            .setBodyTextColor('#ffffff')
            .setBodyBorderColor(cfg.color)
            .setLineWidth(2)
        }

        // --- EMA lines as horizontal overlays ---
        const emaLevels = [
          { val: ema8,  color: '#f59e0b', label: 'EMA 8'  },
          { val: ema21, color: '#818cf8', label: 'EMA 21' },
          { val: ema50, color: '#38bdf8', label: 'EMA 50' },
        ]
        for (const e of emaLevels) {
          if (!e.val) continue
          try {
            chart.createOrderLine()
              .setPrice(e.val)
              .setText(e.label + ' $' + e.val.toFixed(2))
              .setQuantity('')
              .setLineColor(e.color)
              .setBodyBackgroundColor('rgba(0,0,0,0.7)')
              .setBodyTextColor(e.color)
              .setBodyBorderColor(e.color)
              .setLineStyle(2)   // dashed
              .setLineWidth(1)
          } catch (_) { /* ignore if setLineStyle unsupported */ }
        }

        // --- Trigger / Breakout level ---
        if (triggerPrice) {
          const setupLabel = setupType === 'FLAT_TOP' ? 'Flat Top Breakout'
            : setupType === 'WEDGE' ? 'Wedge Breakout'
            : setupType === 'FLAG' ? 'Flag Breakout'
            : setupType === 'BASE' ? 'Base Breakout'
            : 'Breakout Level'
          chart.createOrderLine()
            .setPrice(triggerPrice)
            .setText(`⚡ ${setupLabel} $${triggerPrice.toFixed(2)}`)
            .setQuantity('')
            .setLineColor('#f97316')
            .setBodyBackgroundColor('#f97316')
            .setBodyTextColor('#ffffff')
            .setBodyBorderColor('#f97316')
            .setLineWidth(2)
        }
      })
    }

    // Delay to ensure container is painted before widget measures it.
    addTimer(setTimeout(() => {
      const scriptId = 'tradingview-widget-script'
      const scriptEl = document.getElementById(scriptId) as HTMLScriptElement | null

      if (scriptEl) {
        if (window.TradingView) {
          createWidget()
        } else {
          if ((scriptEl as any).readyState === 'loaded' || (scriptEl as any).readyState === 'complete') {
            createWidget()
          } else {
            scriptEl.addEventListener('load', createWidget, { once: true })
          }
        }
      } else {
        const script = document.createElement('script')
        script.id = scriptId
        script.src = 'https://s3.tradingview.com/tv.js'
        script.async = true
        script.onload = createWidget
        document.head.appendChild(script)
      }
    }, 150))

    return () => {
      mounted = false
      clearTimers()
      addTimer(setTimeout(() => {
        if (container) container.innerHTML = ''
      }, 0))
    }
  }, [symbol, interval, theme, containerId, height, entry, stop, target, direction, ema8, ema21, ema50, triggerPrice, setupType])

  return <div id={containerId} ref={containerRef} style={{ height }} className="w-full" />
}
