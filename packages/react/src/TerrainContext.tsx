import { createContext, useContext, type ReactNode } from "react"
import type { TerrainHandle } from "./types"

const TerrainContext = createContext<TerrainHandle | null>(null)

export interface TerrainProviderProps {
  value: TerrainHandle
  children: ReactNode
}

export function TerrainProvider({ value, children }: TerrainProviderProps) {
  return (
    <TerrainContext.Provider value={value}>{children}</TerrainContext.Provider>
  )
}

export function useTerrainContext(): TerrainHandle {
  const value = useContext(TerrainContext)

  if (!value) {
    throw new Error("useTerrainContext must be used within a TerrainProvider")
  }

  return value
}
