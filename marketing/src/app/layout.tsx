import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { SITE } from "@/config/site"

const geist = localFont({
  src: "../fonts/Geist-Variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
})
const geistMono = localFont({
  src: "../fonts/GeistMono-Variable.woff2",
  variable: "--font-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "habit tracker",
    "budget tracker",
    "workout log",
    "calorie tracker",
    "to-do list",
    "journal",
    "voice logging",
    "all-in-one life tracker",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: "/",
    locale: "en",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Unfurl: Say it. It's tracked.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
    images: ["/og.png"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png" }],
  },
  robots: { index: SITE.indexable, follow: SITE.indexable },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#121513" },
  ],
  width: "device-width",
  initialScale: 1,
}

// Marks the document as script-capable before first paint, so reveal-on-scroll
// styles apply only when the script that reveals them can run.
const jsFlag = "document.documentElement.classList.add('js')"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: jsFlag }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
