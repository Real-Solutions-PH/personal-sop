"use client"

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { type ComponentProps, useEffect } from "react"

/** Point the browser/PWA status bar at the in-app theme, not just the OS one.
 *  Reads --background off <body> so globals.css stays the single source. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (!resolvedTheme) return
    // next-themes swaps the <html> class in its own effect, which runs after ours.
    const id = setTimeout(() => {
      // Computed oklch comes back as lab(); paint 1px to get plain sRGB for the meta tag.
      const ctx = document.createElement("canvas").getContext("2d")
      if (!ctx) return
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      const color = `rgb(${r} ${g} ${b})`
      for (const meta of document.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"]',
      )) {
        meta.content = color
      }
    })
    return () => clearTimeout(id)
  }, [resolvedTheme])
  return null
}

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  )
}

export { useTheme }
