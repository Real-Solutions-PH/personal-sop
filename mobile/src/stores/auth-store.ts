import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { mmkvStorage } from "@/lib/storage"

interface AuthState {
  isAuthenticated: boolean
  userId: string | null
  userEmail: string | null
  userFullName: string | null

  setAuthenticated: (user: {
    id: string
    email: string
    full_name?: string | null
  }) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      userId: null,
      userEmail: null,
      userFullName: null,

      setAuthenticated: (user) =>
        set({
          isAuthenticated: true,
          userId: user.id,
          userEmail: user.email,
          userFullName: user.full_name ?? null,
        }),

      clearAuth: () =>
        set({
          isAuthenticated: false,
          userId: null,
          userEmail: null,
          userFullName: null,
        }),
    }),
    {
      name: "auth-store",
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
)
