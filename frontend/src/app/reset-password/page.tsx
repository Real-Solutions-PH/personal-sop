import type { Metadata } from "next"
import { Suspense } from "react"
import ResetPasswordForm from "./reset-password-form"

export const metadata: Metadata = {
  title: "Reset Password - FastAPI Template",
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
