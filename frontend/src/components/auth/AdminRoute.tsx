import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth()

  if (loading) {
    return <div className="min-h-screen bg-black" />
  }

  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
