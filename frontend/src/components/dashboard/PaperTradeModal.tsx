import { useState } from 'react'
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { OptionsContract } from './OptionsChain'
import { placePaperTrade } from '@/lib/api'
import { cn } from '@/lib/utils'

interface PaperTradeModalProps {
  symbol: string
  contract: OptionsContract
  onClose: () => void
}

type Action = 'buy' | 'sell'

export function PaperTradeModal({ symbol, contract, onClose }: PaperTradeModalProps) {
  const [action, setAction] = useState<Action>('buy')
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Use mid-price as the paper fill price
  const fillPrice =
    contract.bid !== null && contract.ask !== null
      ? parseFloat(((contract.bid + contract.ask) / 2).toFixed(2))
      : contract.last ?? 0

  const premiumTotal = parseFloat((fillPrice * quantity * 100).toFixed(2))

  const handleSubmit = async () => {
    if (fillPrice <= 0) {
      setError('No valid price available for this contract.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await placePaperTrade({
        symbol,
        contract_ticker: contract.ticker,
        contract_type: contract.contract_type,
        strike_price: contract.strike ?? 0,
        expiration_date: contract.expiration,
        action,
        quantity,
        price_per_contract: fillPrice,
        notes: notes.trim() || undefined,
      })
      setSuccess(true)
    } catch (e: any) {
      setError(e.message ?? 'Failed to place paper trade')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-white">Paper Trade Options</h2>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">{contract.ticker}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="h-10 w-10 text-green-400" />
            <p className="text-white font-semibold">Paper trade logged!</p>
            <p className="text-zinc-400 text-sm">
              {action === 'buy' ? 'Bought' : 'Sold'} {quantity} × {contract.contract_type.toUpperCase()} contract{quantity > 1 ? 's' : ''}{' '}
              at ${fillPrice.toFixed(2)} (${premiumTotal.toLocaleString()} premium).
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Contract summary */}
            <div className="bg-zinc-800/60 rounded-lg p-3 text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-zinc-400">Type</span>
                <span className={cn('font-semibold', contract.contract_type === 'call' ? 'text-green-400' : 'text-red-400')}>
                  {contract.contract_type.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Strike</span>
                <span className="text-white">${contract.strike?.toFixed(2) ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Expiry</span>
                <span className="text-white">{contract.expiration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Bid / Ask</span>
                <span className="text-white">${contract.bid?.toFixed(2) ?? '—'} / ${contract.ask?.toFixed(2) ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Fill price (mid)</span>
                <span className="text-cyan-400 font-bold">${fillPrice.toFixed(2)}</span>
              </div>
            </div>

            {/* Buy / Sell toggle */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1.5">Action</label>
              <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                {(['buy', 'sell'] as Action[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => setAction(a)}
                    className={cn(
                      'flex-1 py-2 text-sm font-semibold transition-colors',
                      action === a
                        ? a === 'buy' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    )}
                  >
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1.5">
                Contracts&nbsp;<span className="text-zinc-500">(1 contract = 100 shares)</span>
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1.5">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. breakout play above trigger"
                className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 placeholder-zinc-600"
              />
            </div>

            {/* Premium summary */}
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-3 flex justify-between items-center">
              <span className="text-sm text-zinc-400">Total premium</span>
              <span className="text-lg font-bold text-white">${premiumTotal.toLocaleString()}</span>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-400 text-sm border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || fillPrice <= 0}
                className={cn(
                  'flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2',
                  action === 'buy'
                    ? 'bg-green-600 hover:bg-green-500 text-white disabled:opacity-50'
                    : 'bg-red-600 hover:bg-red-500 text-white disabled:opacity-50'
                )}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? 'Placing…' : `Paper ${action === 'buy' ? 'Buy' : 'Sell'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
