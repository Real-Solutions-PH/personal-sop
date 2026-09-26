import axios from "axios"
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const emailPattern = {
  value: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i,
  message: "Invalid email address",
}

export const namePattern = {
  value: /^[A-Za-z\s\u00C0-\u017F]{1,30}$/,
  message: "Invalid name",
}

export const passwordRules = (isRequired = true) => {
  const rules: Record<string, unknown> = {
    minLength: { value: 8, message: "Password must be at least 8 characters" },
  }
  if (isRequired) rules.required = "Password is required"
  return rules
}

export const confirmPasswordRules = (
  getValues: () => { password?: string; new_password?: string },
  isRequired = true,
) => {
  const rules: Record<string, unknown> = {
    validate: (value: string) => {
      const password = getValues().password || getValues().new_password
      return value === password ? true : "Passwords do not match"
    },
  }
  if (isRequired) rules.required = "Password confirmation is required"
  return rules
}

export function handleError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as
      | { message?: string; details?: Array<{ msg?: string }> | null }
      | undefined
    // Validation errors (422) carry per-field messages in details.
    if (Array.isArray(body?.details) && body.details[0]?.msg) {
      return body.details[0].msg
    }
    if (body?.message) return body.message
    return err.message
  }
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return "An unexpected error occurred"
}
