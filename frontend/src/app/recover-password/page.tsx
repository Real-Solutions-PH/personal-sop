import type { Metadata } from "next"
import RecoverPasswordForm from "./recover-password-form"

export const metadata: Metadata = {
  title: "Recover Password - FastAPI Template",
}

export default function RecoverPasswordPage() {
  return <RecoverPasswordForm />
}
