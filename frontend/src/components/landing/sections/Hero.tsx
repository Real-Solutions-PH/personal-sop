import Link from "next/link"
import { Button } from "@/components/ui/button"

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="container mx-auto flex flex-col items-center gap-6 px-4 py-24 text-center md:py-32">
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Full Stack FastAPI Template
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          Build production-ready apps faster.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          A batteries-included starter with FastAPI, Next.js, and modern tooling
          — so you can focus on what makes your product unique.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get Started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
