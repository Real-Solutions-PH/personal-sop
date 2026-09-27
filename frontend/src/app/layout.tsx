import type { Metadata, Viewport } from "next"
import { Barlow, Barlow_Condensed } from "next/font/google"
import type { ReactNode } from "react"
import { Providers } from "@/components/providers"
import "./globals.css"

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
})
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
})

export const metadata: Metadata = {
  title: "Personal SOP",
  appleWebApp: {
    capable: true,
    title: "SOP",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/assets/images/favicon.png",
  },
}

export const viewport: Viewport = {
  themeColor: "#0f0f14",
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${barlow.variable} ${barlowCondensed.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
