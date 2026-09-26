import type { Metadata } from "next"
import { Footer } from "@/components/Common/Footer"
import { Cta } from "@/components/landing/sections/Cta"
import { Features } from "@/components/landing/sections/Features"
import { Hero } from "@/components/landing/sections/Hero"
import { Navbar } from "@/components/landing/sections/Navbar"

export const metadata: Metadata = {
  title: "Welcome - FastAPI Template",
  description:
    "A production-ready full-stack starter built with FastAPI and Next.js.",
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Features />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}
