import { useState, useEffect } from 'react'
import { BreakoutScan } from '@/hooks/useScanResults'
import { X, Heart, Loader2, BarChart2, LineChart, Layers } from 'lucide-react'
import { TradingViewWidget } from './TradingViewWidget'
import { OptionsChain, OptionsContract } from './OptionsChain'
import { PaperTradeModal } from './PaperTradeModal'
import { addToWatchlist, removeFromWatchlist, checkInWatchlist } from '@/lib/api'
import { cn } from '@/lib/utils'

interface StockDetailPanelProps {
  scan: BreakoutScan | null
  onClose: () => void
}

type DetailTab = 'chart' | 'technical' | 'options'

export function StockDetailPanel({ scan, onClose }: StockDetailPanelProps) {
  const [inWatchlist, setInWatchlist] = useState(false)
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<DetailTab>('chart')
  const [selectedContract, setSelectedContract] = useState<OptionsContract | null>(null)
  const [showPaperTrade, setShowPaperTrade] = useState(false)

  useEffect(() => {
    if (scan?.symbol) {
      checkInWatchlist(scan.symbol).then((res) => setInWatchlist(res.in_watchlist))
    }
    // Reset state when a new stock is selected
    setActiveTab('chart')
    setSelectedContract(null)
    setShowPaperTrade(false)
  }, [scan?.symbol])

  const toggleWatchlist = async () => {
    if (!scan) return
    setWatchlistLoading(true)
    try {
      if (inWatchlist) { await removeFromWatchlist(scan.symbol); setInWatchlist(false) }
      else { await addToWatchlist(scan.symbol); setInWatchlist(true) }
    } catch { } finally { setWatchlistLoading(false) }
  }

  const handleContractSelect = (contract: OptionsContract) => {
    setSelectedContract(contract)
    setShowPaperTrade(true)
  }

  if (!scan) return null

  const formatNumber = (value: number, decimals = 2) => value.toFixed(decimals)

  const formatMarketCap = (value?: number) => {
    if (!value) return 'N/A'
    if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)} Trillion`
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)} Billion`
    return `$${(value / 1_000_000).toFixed(2)} Million`
  }

  const formatVolume = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Million`
    return `${(value / 1_000).toFixed(0)} Thousand`
  }

  const priceTo21  = ((scan.price  / scan.ema21  - 1) * 100).toFixed(2)
  const ema21To50  = ((scan.ema21  / scan.ema50  - 1) * 100).toFixed(2)
  const ema50To200 = ((scan.ema50  / scan.ema200 - 1) * 100).toFixed(2)

  const emaAligned = scan.price > scan.ema21 && scan.ema21 > scan.ema50 && scan.ema50 > scan.ema200

  const TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'chart',     label: 'Chart',     icon: LineChart },
    { id: 'technical', label: 'Technical', icon: BarChart2 },
    { id: 'options',   label: 'Options',   icon: Layers },
  ]

  return (
    <>
      <div className="fixed inset-y-0 right-0 w-full md:w-[950px] bg-zinc-900 border-l border-zinc-800 shadow-2xl overflow-y-auto z-50">
        {/* ── Header ── */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold text-white">{scan.symbol}</h2>
            <p className="text-sm text-zinc-400">{formatMarketCap(scan.market_cap)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleWatchlist}
              disabled={watchlistLoading}
              className={cn(
                'p-2 transition-colors rounded-lg',
                inWatchlist
                  ? 'text-pink-400 bg-pink-500/20 hover:bg-pink-500/30'
                  : 'text-zinc-400 hover:text-pink-400 hover:bg-zinc-800'
              )}
              title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              {watchlistLoading
                ? <Loader2 size={20} className="animate-spin" />
                : <Heart size={20} fill={inWatchlist ? 'currentColor' : 'none'} />}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* ── Breakout summary bar ── */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-800/30 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-zinc-500">Price</p>
            <p className="text-lg font-bold text-white">${formatNumber(scan.price)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Trigger</p>
            <p className="text-lg font-bold text-cyan-400">${formatNumber(scan.trigger_price)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Distance</p>
            <p className="text-lg font-bold text-cyan-400">{formatNumber(scan.distance_pct)}%</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Score</p>
            <p className={cn(
              'text-lg font-bold',
              scan.breakout_score >= 80 ? 'text-green-400' :
              scan.breakout_score >= 70 ? 'text-yellow-400' : 'text-orange-400'
            )}>
              {scan.breakout_score}
            </p>
          </div>
          <span className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-lg',
            scan.setup_type === 'FLAT_TOP' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
            scan.setup_type === 'WEDGE'    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
            scan.setup_type === 'FLAG'     ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' :
            scan.setup_type === 'BASE'     ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
            'bg-gray-500/20 text-gray-300 border border-gray-500/30'
          )}>
            {scan.setup_type.replace('_', ' ')}
          </span>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-zinc-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-white border-b-2 border-cyan-400'
                  : 'text-zinc-500 hover:text-zinc-200'
              )}
            >
              <tab.icon size={15} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="p-4 space-y-4">

          {/* CHART TAB */}
          {activeTab === 'chart' && (
            <div>
              <div className="rounded-lg overflow-hidden border border-zinc-800">
                <TradingViewWidget
                  symbol={scan.symbol}
                  interval="D"
                  theme="dark"
                  height={520}
                  entry={scan.trigger_price}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500 text-center">
                Cyan line = breakout trigger ${formatNumber(scan.trigger_price)} · Powered by TradingView
              </p>
            </div>
          )}

          {/* TECHNICAL TAB */}
          {activeTab === 'technical' && (
            <div className="space-y-4">
              {/* EMA Analysis */}
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-400 uppercase">EMA Analysis</h3>
                  {emaAligned && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-300 text-xs font-medium rounded border border-green-500/30">
                      ✓ Aligned
                    </span>
                  )}
                </div>
                {[
                  { label: 'Price vs EMA21',   left: scan.price,  right: scan.ema21,  pct: priceTo21  },
                  { label: 'EMA21 vs EMA50',   left: scan.ema21,  right: scan.ema50,  pct: ema21To50  },
                  { label: 'EMA50 vs EMA200',  left: scan.ema50,  right: scan.ema200, pct: ema50To200 },
                ].map(({ label, left, right, pct }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-zinc-700 last:border-0">
                    <div>
                      <p className="text-sm text-zinc-300">{label}</p>
                      <p className="text-xs text-zinc-500">${formatNumber(left)} vs ${formatNumber(right)}</p>
                    </div>
                    <p className={cn('text-sm font-semibold', parseFloat(pct) >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {parseFloat(pct) >= 0 ? '+' : ''}{pct}%
                    </p>
                  </div>
                ))}
              </div>

              {/* Volatility & Volume */}
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase">Volatility & Volume</h3>
                <div className="flex justify-between">
                  <span className="text-sm text-zinc-300">ADR (14-day)</span>
                  <span className="text-sm font-semibold text-white">{formatNumber(scan.adr_pct_14)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-zinc-300">Avg Volume (50-day)</span>
                  <span className="text-sm font-semibold text-white">{formatVolume(scan.avg_vol_50)}</span>
                </div>
              </div>

              {/* Notes */}
              {scan.notes && scan.notes.length > 0 && (
                <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-400 uppercase">Pattern Notes</h3>
                  <div className="flex flex-wrap gap-2">
                    {scan.notes.map((note, idx) => (
                      <span key={idx} className="px-2 py-1 bg-zinc-700 text-zinc-300 text-xs rounded border border-zinc-600">
                        {note}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* OPTIONS TAB */}
          {activeTab === 'options' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                Click a contract row or the cart icon to paper-trade it.
              </p>
              <OptionsChain symbol={scan.symbol} onSelectContract={handleContractSelect} />
            </div>
          )}
        </div>

        {/* Scanned At */}
        <div className="text-center text-xs text-zinc-500 py-4 border-t border-zinc-800">
          Scanned {new Date(scan.scanned_at).toLocaleString()}
        </div>
      </div>

      {/* Paper trade modal — rendered outside the panel so it sits on top */}
      {showPaperTrade && selectedContract && (
        <PaperTradeModal
          symbol={scan.symbol}
          contract={selectedContract}
          onClose={() => { setShowPaperTrade(false); setSelectedContract(null) }}
        />
      )}
    </>
  )
}
