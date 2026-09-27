import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const RefreshContext = createContext(Date.now())
export function ConsoleRefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 15_000); return () => window.clearInterval(timer) }, [])
  return <RefreshContext.Provider value={tick}>{children}</RefreshContext.Provider>
}
export function useConsoleRefresh() { return useContext(RefreshContext) }
