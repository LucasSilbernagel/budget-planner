import { create } from 'zustand'
import type { IncomeSource, NewIncomeSource, Frequency } from '@budget-planner/db'

// Define the type for our store state
interface IncomeState {
  incomeSources: IncomeSource[]
  addIncomeSource: (incomeSource: NewIncomeSource) => void
  updateIncomeSource: (id: number, updates: Partial<NewIncomeSource>) => void
  deleteIncomeSource: (id: number) => void
  getIncomeSourceById: (id: number) => IncomeSource | undefined
  getIncomeSourcesByFrequency: (frequency: Frequency) => IncomeSource[]
  getTotalIncome: () => number
}

// Helper to generate a temporary ID for client-side storage
// Note: In production with backend, IDs will come from the database
// Using negative IDs for temporary client-side entries to avoid conflicts
let tempIdCounter = 0
const generateTempId = (): number => {
  tempIdCounter -= 1
  return tempIdCounter
}

// Convert NewIncomeSource to IncomeSource (add id and timestamps)
const toIncomeSource = (newSource: NewIncomeSource): IncomeSource => ({
  ...newSource,
  id: generateTempId(),
  createdAt: new Date(),
  updatedAt: new Date(),
})

export const useIncomeStore = create<IncomeState>()(
  (set, get) => ({
    // Initial state
    incomeSources: [],

    // Add a new income source
    addIncomeSource: (newIncomeSource) => {
      const incomeSource = toIncomeSource(newIncomeSource)
      set((state) => ({
        incomeSources: [...state.incomeSources, incomeSource],
      }))
    },

    // Update an existing income source
    updateIncomeSource: (id, updates) => {
      set((state) => ({
        incomeSources: state.incomeSources.map((source) =>
          source.id === id
            ? { ...source, ...updates, updatedAt: new Date() }
            : source
        ),
      }))
    },

    // Delete an income source
    deleteIncomeSource: (id) => {
      set((state) => ({
        incomeSources: state.incomeSources.filter(
          (source) => source.id !== id
        ),
      }))
    },

    // Get income source by ID
    getIncomeSourceById: (id) => {
      return get().incomeSources.find((source) => source.id === id)
    },

    // Get income sources filtered by frequency
    getIncomeSourcesByFrequency: (frequency) => {
      return get().incomeSources.filter(
        (source) => source.frequency === frequency
      )
    },

    // Calculate total income (sum of all amounts in cents)
    getTotalIncome: () => {
      return get().incomeSources.reduce(
        (sum, source) => sum + source.amount,
        0
      )
    },
  })
)

// Selector hooks for better performance
export const useIncomeSources = () =>
  useIncomeStore((state) => state.incomeSources)

export const useTotalIncome = () =>
  useIncomeStore((state) => state.getTotalIncome())

export const useIncomeByFrequency = (frequency: Frequency) =>
  useIncomeStore((state) => state.getIncomeSourcesByFrequency(frequency))

// Note: Client-side persistence will be added in Story 1.6
// For now, state is in-memory only (cleared on page refresh)
