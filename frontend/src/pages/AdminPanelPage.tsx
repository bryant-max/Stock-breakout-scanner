import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import {
  BarChart2, Users, Brain, Layers, Trash2, Upload,
  RefreshCw, Shield, TrendingUp, DollarSign, UserCheck,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"

type Tab = "overview" | "plan-switcher" | "knowledge" | "users"

// Plan switcher options (admin QA only — stored in localStorage)
const QA_PLANS = ["live", "free", "core", "premium"] as const
type QAPlan = (typeof QA_PLANS)[number]
const QA_PLAN_LABELS: Record<QAPlan, string> = {
  live: "Live (Your Actual Plan)",
  free: "Free",
  core: "Core — $39/mo",
  premium: "Premium — $79/mo",
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function adminFetch(path: string, token: string | undefined, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.detail ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

// ── Sub-sections ──────────────────────────────────────────────────────────

function OverviewSection({ token }: { token: string | undefined }) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch("/api/admin/stats", token)
      setStats(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />
  if (error) return <ErrorBox msg={error} onRetry={load} />

  const breakdown: Record<string, number> = stats?.plan_breakdown ?? {}

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: stats?.total_users ?? 0, icon: Users, color: "text-blue-400" },
          { label: "Active Subscriptions", value: stats?.active_subscriptions ?? 0, icon: UserCheck, color: "text-[#00ff88]" },
          { label: "Est. Monthly Revenue", value: `$${(stats?.monthly_revenue_estimate ?? 0).toLocaleString()}`, icon: DollarSign, color: "text-yellow-400" },
          { label: "Premium Users", value: breakdown["premium"] ?? 0, icon: TrendingUp, color: "text-purple-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-white/2 border-white/10 p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/50">{s.label}</p>
              <s.icon className={cn("h-4 w-4", s.color)} />
            </div>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Plan breakdown */}
      <Card className="bg-white/2 border-white/10 p-6">
        <h3 className="font-semibold text-white mb-4">Plan Breakdown</h3>
        <div className="flex flex-wrap gap-3">
          {Object.entries(breakdown).length === 0 ? (
            <p className="text-white/40 text-sm">No subscriptions yet.</p>
          ) : (
            Object.entries(breakdown).map(([plan, count]) => (
              <div key={plan} className="flex items-center gap-2 border border-white/10 bg-white/5 px-4 py-2 rounded">
                <span className="font-mono text-xs uppercase text-white/60">{plan}</span>
                <Badge className="bg-[#00ff88]/20 text-[#00ff88] border-[#00ff88]/30">{count}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Recent signups */}
      <Card className="bg-white/2 border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="font-semibold text-white">Recent Signups</h3>
          <Button variant="outline" size="sm" onClick={load} className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
        {(stats?.recent_signups ?? []).length === 0 ? (
          <p className="px-6 py-8 text-white/40 text-sm">No recent signups.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {(stats?.recent_signups ?? []).map((u: any) => (
              <div key={u.id} className="px-6 py-3 flex items-center justify-between">
                <span className="text-sm text-white">{u.email ?? u.id}</span>
                <span className="text-xs text-white/40 font-mono">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function PlanSwitcherSection() {
  const [selected, setSelected] = useState<QAPlan>(() => {
    return (localStorage.getItem("adminPlanOverride") as QAPlan) ?? "live"
  })

  const handleChange = (plan: QAPlan) => {
    setSelected(plan)
    if (plan === "live") {
      localStorage.removeItem("adminPlanOverride")
    } else {
      localStorage.setItem("adminPlanOverride", plan)
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <Card className="bg-white/2 border-white/10 p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="p-2 rounded-lg bg-purple-500/15">
            <Layers className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Admin Plan Simulator</h3>
            <p className="text-sm text-white/50 mt-1">
              Override what plan the app UI shows — for QA only. Never visible to regular users.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {QA_PLANS.map((plan) => (
            <button
              key={plan}
              onClick={() => handleChange(plan)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 border rounded-lg text-left transition-all",
                selected === plan
                  ? "border-[#00ff88] bg-[#00ff88]/10 text-white"
                  : "border-white/10 bg-white/2 text-white/60 hover:border-white/20 hover:text-white"
              )}
            >
              <span className="font-mono text-sm">{QA_PLAN_LABELS[plan]}</span>
              {selected === plan && (
                <Badge className="bg-[#00ff88]/20 text-[#00ff88] border-[#00ff88]/30 text-[10px]">Active</Badge>
              )}
            </button>
          ))}
        </div>

        {selected !== "live" && (
          <div className="mt-4 border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 rounded-lg">
            <p className="text-xs text-yellow-400 font-mono">
              ⚠ Plan override active: <strong>{QA_PLAN_LABELS[selected]}</strong>. App UI reflects this plan. Only you see this.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

function KnowledgeSection({ token }: { token: string | undefined }) {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [sourceLabel, setSourceLabel] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch("/api/admin/knowledge", token)
      setEntries(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { loadEntries() }, [loadEntries])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setContent((prev) => prev + (prev ? "\n\n" : "") + (ev.target?.result as string ?? ""))
      if (!sourceLabel) setSourceLabel(file.name)
    }
    reader.readAsText(file)
  }

  const handleSubmit = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await adminFetch("/api/admin/knowledge", token, {
        method: "POST",
        body: JSON.stringify({ content: content.trim(), source_label: sourceLabel.trim() || "manual" }),
      })
      setContent("")
      setSourceLabel("")
      if (fileRef.current) fileRef.current.value = ""
      await loadEntries()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await adminFetch(`/api/admin/knowledge/${id}`, token, { method: "DELETE" })
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-6">
      {/* Submit form */}
      <Card className="bg-white/2 border-white/10 p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2 rounded-lg bg-blue-500/15">
            <Brain className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Add Knowledge</h3>
            <p className="text-sm text-white/50 mt-1">Paste text or upload a file to feed knowledge to Sean.</p>
          </div>
        </div>

        {error && <div className="mb-4 border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400 font-mono">{error}</div>}

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Source label (e.g. 'Q4 strategy notes')"
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#00ff88]/50 rounded-lg"
          />
          <textarea
            placeholder="Paste knowledge content here…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#00ff88]/50 rounded-lg resize-y"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer border border-white/10 bg-white/5 hover:border-white/20 px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white transition-colors">
              <Upload className="h-4 w-4" />
              Upload .txt / .md
              <input ref={fileRef} type="file" accept=".txt,.md,.csv" className="hidden" onChange={handleFileChange} />
            </label>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="bg-[#00ff88] text-black hover:bg-[#00ff88]/80 font-mono text-sm disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit to AI"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Entries list */}
      <Card className="bg-white/2 border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="font-semibold text-white">Knowledge Entries ({entries.length})</h3>
          <Button variant="outline" size="sm" onClick={loadEntries} className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
        {loading ? (
          <div className="px-6 py-8 flex justify-center"><RefreshCw className="h-5 w-5 text-white/30 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <p className="px-6 py-8 text-white/40 text-sm">No entries yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map((entry) => (
              <div key={entry.id} className="px-6 py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-[#00ff88] truncate">{entry.source_label || "manual"}</span>
                    <span className="text-xs text-white/30">{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : ""}</span>
                  </div>
                  <p className="text-sm text-white/70 line-clamp-2">{entry.content}</p>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="shrink-0 p-1.5 text-white/30 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function UsersSection({ token }: { token: string | undefined }) {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch("/api/admin/users", token)
      setUsers(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const updatePlan = async (userId: string, plan: string) => {
    setUpdatingId(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}/plan`, token, {
        method: "PATCH",
        body: JSON.stringify({ plan }),
      })
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, plan } : u))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUpdatingId(null)
    }
  }

  if (loading) return <Spinner />
  if (error) return <ErrorBox msg={error} onRetry={load} />

  return (
    <Card className="bg-white/2 border-white/10 overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <h3 className="font-semibold text-white">All Users ({users.length})</h3>
        <Button variant="outline" size="sm" onClick={load} className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left">
              {["Email", "Plan", "Status", "Signed Up", "Change Plan"].map((h) => (
                <th key={h} className="px-6 py-3 font-mono text-xs uppercase text-white/40">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-white/2 transition-colors">
                <td className="px-6 py-3 text-white truncate max-w-[200px]">{u.email}</td>
                <td className="px-6 py-3">
                  <Badge className={cn(
                    "font-mono text-[10px] uppercase",
                    u.plan === "premium" ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                    u.plan === "core" ? "bg-[#00ff88]/20 text-[#00ff88] border-[#00ff88]/30" :
                    "bg-white/10 text-white/50 border-white/20"
                  )}>
                    {u.plan ?? "free"}
                  </Badge>
                </td>
                <td className="px-6 py-3 text-white/50 font-mono text-xs">{u.subscription_status ?? "—"}</td>
                <td className="px-6 py-3 text-white/40 font-mono text-xs">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-6 py-3">
                  <select
                    value={u.plan ?? "free"}
                    disabled={updatingId === u.id}
                    onChange={(e) => updatePlan(u.id, e.target.value)}
                    className="bg-white/5 border border-white/10 text-white text-xs font-mono px-2 py-1.5 rounded focus:outline-none focus:border-[#00ff88]/50 disabled:opacity-50"
                  >
                    {["free", "core", "premium"].map((p) => (
                      <option key={p} value={p} className="bg-neutral-900">{p}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Shared micro-components ────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <RefreshCw className="h-6 w-6 text-white/30 animate-spin" />
    </div>
  )
}

function ErrorBox({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <Card className="bg-red-500/10 border-red-500/30 p-6 flex items-center justify-between">
      <p className="text-red-400 text-sm font-mono">{msg}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="border-red-500/30 text-red-400 hover:bg-red-500/10">Retry</Button>
    </Card>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: BarChart2 },
  { id: "plan-switcher", label: "Plan Switcher", icon: Layers },
  { id: "knowledge", label: "AI Knowledge", icon: Brain },
  { id: "users", label: "User Management", icon: Users },
]

export default function AdminPanelPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const { user } = useAuth()
  const [token, setToken] = useState<string | undefined>()

  useEffect(() => {
    const fetchToken = async () => {
      const { data } = await supabase.auth.getSession()
      setToken(data.session?.access_token)
    }
    void fetchToken()
  }, [])

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-white/5 bg-neutral-950 flex flex-col">
        <div className="px-5 py-6 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#00ff88]/20">
              <Shield className="h-4 w-4 text-[#00ff88]" />
            </div>
            <span className="font-mono text-sm font-bold text-white uppercase tracking-wide">Admin</span>
          </div>
          <p className="text-xs text-white/30 mt-2 truncate">{user?.email}</p>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm font-medium",
                activeTab === tab.id
                  ? "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              )}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <a href="/dashboard" className="block text-center font-mono text-xs text-white/30 hover:text-white transition-colors">
            ← Back to App
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-white/5 bg-black/80 backdrop-blur px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h1>
            <p className="text-xs text-white/40">Orbis Admin Panel</p>
          </div>
          <Badge className="bg-[#00ff88]/20 text-[#00ff88] border-[#00ff88]/30 text-xs font-mono">Admin Access</Badge>
        </header>

        <div className="p-8">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "overview" && <OverviewSection token={token} />}
            {activeTab === "plan-switcher" && <PlanSwitcherSection />}
            {activeTab === "knowledge" && <KnowledgeSection token={token} />}
            {activeTab === "users" && <UsersSection token={token} />}
          </motion.div>
        </div>
      </main>
    </div>
  )
}
