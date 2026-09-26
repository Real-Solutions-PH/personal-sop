"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

import ErrorComponent from "@/components/Common/ErrorComponent"

export default function ErrorPage({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return <ErrorComponent />
}
