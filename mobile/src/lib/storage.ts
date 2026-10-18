import Constants, { ExecutionEnvironment } from "expo-constants"
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"
import type { StateStorage } from "zustand/middleware"

interface KVStore {
  getString(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
}

function createWebStore(): KVStore {
  const memory = new Map<string, string>()
  const hasLocalStorage =
    globalThis.window !== undefined && !!globalThis.localStorage

  return {
    getString(key) {
      if (hasLocalStorage) {
        return globalThis.localStorage.getItem(key) ?? undefined
      }
      return memory.get(key)
    },
    set(key, value) {
      if (hasLocalStorage) {
        globalThis.localStorage.setItem(key, value)
        return
      }
      memory.set(key, value)
    },
    remove(key) {
      if (hasLocalStorage) {
        globalThis.localStorage.removeItem(key)
        return
      }
      memory.delete(key)
    },
  }
}

type MMKVModule = typeof import("react-native-mmkv")
type SQLiteKVModule = typeof import("expo-sqlite/kv-store")

// Expo Go cannot load MMKV v4 (it needs the NitroModules native module, which
// Expo Go does not ship), so there both stores fall back to expo-sqlite's
// synchronous key-value store. Detected explicitly rather than by catching the
// load error, so a dev or release build missing MMKV still fails loudly.
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient

// Each store gets its own key prefix so the session never shares keys with
// the general app-state store.
function createExpoGoStore(prefix: string): KVStore {
  const { Storage } = require("expo-sqlite/kv-store") as SQLiteKVModule
  return {
    getString: (key) => Storage.getItemSync(prefix + key) ?? undefined,
    set: (key, value) => Storage.setItemSync(prefix + key, value),
    remove: (key) => {
      Storage.removeItemSync(prefix + key)
    },
  }
}

function createNativeStore(): KVStore {
  if (isExpoGo) return createExpoGoStore("general:")
  const { createMMKV } = require("react-native-mmkv") as MMKVModule
  const instance = createMMKV()
  return {
    getString: (key) => instance.getString(key),
    set: (key, value) => instance.set(key, value),
    remove: (key) => instance.remove(key),
  }
}

let generalStore: KVStore | undefined
function getGeneralStore() {
  generalStore ??=
    Platform.OS === "web" ? createWebStore() : createNativeStore()
  return generalStore
}
export const mmkv: KVStore = {
  getString: (key) => getGeneralStore().getString(key),
  set: (key, value) => getGeneralStore().set(key, value),
  remove: (key) => getGeneralStore().remove(key),
}

export const mmkvStorage: StateStorage = {
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => {
    mmkv.remove(name)
  },
}

// --- Encrypted at-rest store for the Supabase auth session (tokens) ---------
//
// The Supabase session holds access/refresh tokens; unlike the general MMKV
// above it is opened with AES-256 encryption. The key is generated once per
// install and kept in the OS keystore (expo-secure-store), never in MMKV
// itself. Web has no equivalent primitive here, so it keeps the same
// localStorage/in-memory path as `mmkv`.

// Distinct MMKV file so the encrypted session never shares storage with the
// plaintext app-state store above.
const SESSION_STORE_ID = "supabase-session"
// Keystore alias for the MMKV encryption key.
const SESSION_KEY_ALIAS = "supabase-session-encryption-key"

/** 16 random bytes as 32 hex chars — a 32-byte string, valid as an AES-256 key. */
function generateEncryptionKey(): string {
  const bytes = Crypto.getRandomBytes(16)
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex
}

async function getOrCreateSessionEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SESSION_KEY_ALIAS)
  if (existing) return existing
  const key = generateEncryptionKey()
  await SecureStore.setItemAsync(SESSION_KEY_ALIAS, key)
  return key
}

async function openEncryptedNativeStore(): Promise<KVStore> {
  // Expo Go only: unencrypted, because MMKV is unavailable there. Dev-only
  // runtime; every installed build takes the encrypted MMKV path below.
  if (isExpoGo) return createExpoGoStore(`${SESSION_STORE_ID}:`)
  const { createMMKV } = require("react-native-mmkv") as MMKVModule
  const encryptionKey = await getOrCreateSessionEncryptionKey()
  const instance = createMMKV({
    id: SESSION_STORE_ID,
    encryptionKey,
    encryptionType: "AES-256",
  })
  return {
    getString: (key) => instance.getString(key),
    set: (key, value) => instance.set(key, value),
    remove: (key) => instance.remove(key),
  }
}

let sessionStorePromise: Promise<KVStore> | null = null

/**
 * The store backing the Supabase auth session. Native: an AES-256-encrypted
 * MMKV instance keyed from the OS keystore. Web: the same localStorage
 * fallback as `mmkv`. Memoized, and reset on failure so a transient keystore
 * error can be retried rather than cached forever.
 */
export function getEncryptedSessionStore(): Promise<KVStore> {
  sessionStorePromise ??= (
    Platform.OS === "web"
      ? Promise.resolve(createWebStore())
      : openEncryptedNativeStore()
  ).catch((err) => {
    sessionStorePromise = null
    throw err
  })
  return sessionStorePromise
}
