import { AxiosError } from "axios"
import type { ApiError, ErrorResponse } from "./client"

function extractErrorMessage(err: ApiError): string {
  if (err instanceof AxiosError) {
    return err.message
  }

  const body = err.body as ErrorResponse | undefined
  const details = body?.details
  // Validation errors (422) carry per-field messages in details.
  if (Array.isArray(details) && details.length > 0 && details[0]?.msg) {
    return details[0].msg
  }
  return body?.message || "Something went wrong."
}

export const handleError = function (
  this: (msg: string) => void,
  err: ApiError,
) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
