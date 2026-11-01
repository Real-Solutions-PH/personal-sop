// The first app screen has laid out: the boot screen may leave. A screen's
// container (Screen, AuthScreen, Welcome) reports it from its onLayout,
// which runs once its own frame, content included, has been committed.
let shown = false
const waiting = new Set<() => void>()

export function screenShown() {
  if (shown) return
  shown = true
  for (const f of [...waiting]) f()
  waiting.clear()
}

/** Calls ``f`` once a screen has shown (at once if one already has). */
export function onScreenShown(f: () => void): () => void {
  if (shown) {
    f()
    return () => {}
  }
  waiting.add(f)
  return () => waiting.delete(f)
}

/** Tests only. */
export function resetScreenShown() {
  shown = false
  waiting.clear()
}
