/**
 * storage.ts picks its backend once at module load (Platform.OS), so each
 * test imports a fresh copy inside jest.isolateModules with the platform
 * and native module mocked per-case.
 */

type StorageModule = typeof import("@/lib/storage")

function loadStorage(platform: "ios" | "android" | "web"): StorageModule {
  let mod: StorageModule | undefined
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ Platform: { OS: platform } }))
    mod = require("@/lib/storage")
  })
  if (!mod) throw new Error("storage module failed to load")
  return mod
}

const mockMmkvSet = jest.fn()
const mockMmkvGetString = jest.fn()
const mockMmkvRemove = jest.fn()
const mockCreateMMKV = jest.fn((..._args: unknown[]) => ({
  set: mockMmkvSet,
  getString: mockMmkvGetString,
  remove: mockMmkvRemove,
}))
jest.mock("react-native-mmkv", () => ({
  createMMKV: (...args: unknown[]) => mockCreateMMKV(...args),
}))

const mockGetItemAsync = jest.fn()
const mockSetItemAsync = jest.fn()
jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
}))

const mockGetRandomBytes = jest.fn()
jest.mock("expo-crypto", () => ({
  getRandomBytes: (...args: unknown[]) => mockGetRandomBytes(...args),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe("native platforms", () => {
  it("routes get/set/delete through MMKV", () => {
    const { mmkv } = loadStorage("ios")
    mockMmkvGetString.mockReturnValue("stored")

    mmkv.set("token", "abc")
    expect(mockMmkvSet).toHaveBeenCalledWith("token", "abc")
    expect(mmkv.getString("token")).toBe("stored")
    mmkv.remove("token")
    expect(mockMmkvRemove).toHaveBeenCalledWith("token")
  })
})

describe("web without localStorage (SSR / static export)", () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    // Simulate the SSR / static-export pass: no window, no localStorage.
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  })

  it("round-trips through the in-memory fallback and never touches MMKV", () => {
    expect(globalThis.window).toBeUndefined()
    const { mmkv } = loadStorage("web")

    expect(mmkv.getString("k")).toBeUndefined()
    mmkv.set("k", "v")
    expect(mmkv.getString("k")).toBe("v")
    mmkv.remove("k")
    expect(mmkv.getString("k")).toBeUndefined()

    expect(mockMmkvSet).not.toHaveBeenCalled()
    expect(mockMmkvGetString).not.toHaveBeenCalled()
  })
})

describe("web with localStorage", () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    const localStorageStub = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    }
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageStub,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
    delete (globalThis as Record<string, unknown>).localStorage
  })

  it("round-trips through localStorage", () => {
    const { mmkv } = loadStorage("web")

    mmkv.set("session", "jwt")
    expect(store.session).toBe("jwt")
    expect(mmkv.getString("session")).toBe("jwt")
    mmkv.remove("session")
    expect(store.session).toBeUndefined()
    expect(mmkv.getString("session")).toBeUndefined()
  })
})

describe("mmkvStorage (zustand StateStorage adapter)", () => {
  it("maps missing keys to null, not undefined", () => {
    const { mmkvStorage } = loadStorage("web")
    expect(mmkvStorage.getItem("nope")).toBeNull()
    mmkvStorage.setItem("yes", "1")
    expect(mmkvStorage.getItem("yes")).toBe("1")
  })
})

describe("getEncryptedSessionStore (native, at-rest encryption)", () => {
  it("generates a key on first launch, persists it, and opens an encrypted MMKV", async () => {
    mockGetItemAsync.mockResolvedValue(null)
    // 16 bytes of 0xab -> "ab" * 16 hex chars (a 32-byte AES-256 key string).
    mockGetRandomBytes.mockReturnValue(new Uint8Array(16).fill(0xab))
    const expectedKey = "ab".repeat(16)

    const { getEncryptedSessionStore } = loadStorage("ios")
    const store = await getEncryptedSessionStore()

    expect(mockGetRandomBytes).toHaveBeenCalledWith(16)
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1)
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      expectedKey,
    )
    expect(mockCreateMMKV).toHaveBeenCalledWith({
      id: "supabase-session",
      encryptionKey: expectedKey,
      encryptionType: "AES-256",
    })

    store.set("k", "v")
    expect(mockMmkvSet).toHaveBeenCalledWith("k", "v")
  })

  it("reuses the stored key on later launches without regenerating", async () => {
    const stored = "deadbeefdeadbeefdeadbeefdeadbeef"
    mockGetItemAsync.mockResolvedValue(stored)

    const { getEncryptedSessionStore } = loadStorage("ios")
    await getEncryptedSessionStore()

    expect(mockGetRandomBytes).not.toHaveBeenCalled()
    expect(mockSetItemAsync).not.toHaveBeenCalled()
    expect(mockCreateMMKV).toHaveBeenCalledWith(
      expect.objectContaining({ encryptionKey: stored }),
    )
  })

  it("opens the key and store exactly once (memoized)", async () => {
    mockGetItemAsync.mockResolvedValue("deadbeefdeadbeefdeadbeefdeadbeef")

    const { getEncryptedSessionStore } = loadStorage("ios")
    await getEncryptedSessionStore()
    await getEncryptedSessionStore()

    expect(mockGetItemAsync).toHaveBeenCalledTimes(1)
    // createMMKV also runs once for the plaintext `mmkv` at import; the
    // encrypted session store must open exactly once across both calls.
    const sessionOpens = mockCreateMMKV.mock.calls.filter(
      (c) => (c[0] as { id?: string } | undefined)?.id === "supabase-session",
    )
    expect(sessionOpens).toHaveLength(1)
  })
})

describe("getEncryptedSessionStore (web keeps the localStorage path)", () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
        },
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
    delete (globalThis as Record<string, unknown>).localStorage
  })

  it("round-trips through localStorage and touches no native crypto", async () => {
    const { getEncryptedSessionStore } = loadStorage("web")
    const sessionStore = await getEncryptedSessionStore()

    sessionStore.set("session", "jwt")
    expect(store.session).toBe("jwt")
    expect(sessionStore.getString("session")).toBe("jwt")

    expect(mockGetItemAsync).not.toHaveBeenCalled()
    expect(mockSetItemAsync).not.toHaveBeenCalled()
    expect(mockGetRandomBytes).not.toHaveBeenCalled()
    expect(mockCreateMMKV).not.toHaveBeenCalled()
  })
})
