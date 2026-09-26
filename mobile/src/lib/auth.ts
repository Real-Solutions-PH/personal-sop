import axios, { type AxiosInstance } from "axios"
import Constants from "expo-constants"
import { getSupabase } from "@/lib/supabase"

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:8000"

/** Access token for the current Supabase session, if any. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

export function createApiClient(): AxiosInstance {
  const instance = axios.create({ baseURL: API_URL })

  instance.interceptors.request.use(async (config) => {
    const token = await getAccessToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  return instance
}

export const api = createApiClient()
