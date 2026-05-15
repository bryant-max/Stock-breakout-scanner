import { useState, useEffect, createContext, useContext, ReactNode } from 'react'
import { User, AuthError, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isAdminEmail } from '../lib/adminConfig'

interface AuthContextType {
  user: User | null
  isAdmin: boolean
  loading: boolean
  signUp: (email: string, password: string, fullName?: string, phone?: string) => Promise<{ error: AuthError | null }>
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<{ error: AuthError | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const checkAdminStatus = async (_userId: string, email?: string) => {
    // Primary: check email against hardcoded allowlist (instant, no DB round-trip)
    if (isAdminEmail(email)) {
      setIsAdmin(true)
      return
    }
    // Fallback: check profiles table is_admin flag
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', _userId)
        .single()
      setIsAdmin(!error && !!data?.is_admin)
    } catch {
      setIsAdmin(false)
    }
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        checkAdminStatus(session.user.id, session.user.email)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          checkAdminStatus(session.user.id, session.user.email)
        } else {
          setIsAdmin(false)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, fullName?: string, phone?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          full_name: fullName,
          ...(phone ? { phone } : {}),
        }
      }
    })
    return { error }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    return { error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}