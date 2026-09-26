import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface Feature {
  title: string
  description: string
}

const features: Feature[] = [
  {
    title: "FastAPI Backend",
    description: "Async, typed Python API with automatic OpenAPI docs.",
  },
  {
    title: "Next.js Frontend",
    description: "App Router, server components, and a typed API client.",
  },
  {
    title: "Auth Built-in",
    description:
      "Email/password auth, password recovery, and protected routes.",
  },
  {
    title: "Type-Safe",
    description:
      "End-to-end types from Pydantic models to generated TS client.",
  },
  {
    title: "Dockerized",
    description: "Compose-based dev and deploy with sane defaults.",
  },
  {
    title: "Tested",
    description: "Pytest on the backend, Cypress E2E per user flow.",
  },
]

export function Features() {
  return (
    <section id="features" className="border-t bg-muted/30">
      <div className="container mx-auto px-4 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Everything you need
          </h2>
          <p className="mt-3 text-muted-foreground">
            Opinionated defaults for the parts every app needs, so you can ship
            the rest.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
