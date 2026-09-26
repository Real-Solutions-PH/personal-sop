import type { Metadata } from "next"
import LoginForm from "./login-form"

export const metadata: Metadata = {
  title: "Log In - FastAPI Template",
}

export default function LoginPage() {
  return <LoginForm />
}
