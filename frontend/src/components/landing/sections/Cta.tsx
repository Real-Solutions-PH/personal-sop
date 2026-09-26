import Link from "next/link"
import { Button } from "@/components/ui/button"

export function Cta() {
  return (
    <section id="cta" className="border-t">
      <div className="container mx-auto px-4 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-2xl border bg-card p-10 text-center shadow-sm">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Ready to start building?
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Spin up your account and ship your first feature today.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Create an account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">I already have one</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
