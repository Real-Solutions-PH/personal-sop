// Row ids that the device and the server agree on.
//
// newId(): a UUID v4 for any row the device creates (the server accepts
// client-minted ids, so an offline create replays without id remapping).
// derivedId(kind, parent, key): a UUID v5, byte-identical to the backend's
// app.shared.ids.derived_id, for rows a domain action derives (the next
// recurring task, the record a settled bill writes, a habit a workout ticks).
// Both sides minting the same id is what keeps an offline action and its
// server replay from creating the row twice.

const DERIVED_NAMESPACE = "6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5"

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

function format(bytes: Uint8Array): string {
  const h = hex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.getRandomValues) c.getRandomValues(out)
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
  return out
}

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (typeof c?.randomUUID === "function") return c.randomUUID()
  const b = randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  return format(b)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

function uuidBytes(u: string): Uint8Array {
  const h = u.replace(/-/g, "")
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++)
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// SHA-1 (RFC 3174), only for UUID v5 — not used for any security purpose.
function sha1(data: Uint8Array): Uint8Array {
  const ml = data.length * 8
  const withPad = new Uint8Array(((data.length + 9 + 63) >> 6) << 6)
  withPad.set(data)
  withPad[data.length] = 0x80
  const view = new DataView(withPad.buffer)
  view.setUint32(withPad.length - 4, ml >>> 0)
  view.setUint32(withPad.length - 8, Math.floor(ml / 2 ** 32))
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++)
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  const words = [h0, h1, h2, h3, h4]
  for (let i = 0; i < words.length; i++) ov.setUint32(i * 4, words[i])
  return out
}

export function uuidV5(name: string, namespace: string): string {
  const ns = uuidBytes(namespace)
  const n = utf8(name)
  const buf = new Uint8Array(ns.length + n.length)
  buf.set(ns)
  buf.set(n, ns.length)
  const hash = sha1(buf).slice(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  return format(hash)
}

export function derivedId(kind: string, parent: string, key: string): string {
  if (!kind || kind.includes(":"))
    throw new Error("kind must be a token without ':'")
  return uuidV5(`${kind}:${parent}:${key}`, DERIVED_NAMESPACE)
}
