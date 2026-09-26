"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { AuthLayout } from "@/components/Common/AuthLayout"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import useCustomToast from "@/hooks/useCustomToast"
import { createClient } from "@/lib/supabase/client"

const formSchema = z
  .object({
    new_password: z
      .string()
      .min(1, { message: "Password is required" })
      .min(8, { message: "Password must be at least 8 characters" }),
    confirm_password: z
      .string()
      .min(1, { message: "Password confirmation is required" }),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "The passwords don't match",
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

type LinkState = "pending" | "ready" | "invalid"

export default function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [linkState, setLinkState] = useState<LinkState>("pending")

  const code = searchParams.get("code")

  // createClient() is only called in effects and callbacks (never at render
  // time) so this page can be prerendered without Supabase env at build time.
  useEffect(() => {
    const supabase = createClient()

    // Late-arriving recovery sessions (implicit-flow PASSWORD_RECOVERY event
    // or an auto-exchange finishing after the initial check below).
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" || session) {
          setLinkState("ready")
        }
      },
    )

    // getSession() awaits client initialization, which already auto-exchanges
    // a ?code=... recovery link (detectSessionInUrl). Only exchange manually
    // if that did not produce a session — a second exchange of a consumed
    // code always fails.
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        setLinkState("ready")
        return
      }
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        setLinkState(error ? "invalid" : "ready")
        return
      }
      // No code and no session — the page was reached without a valid
      // recovery link.
      setLinkState((state) => (state === "pending" ? "invalid" : state))
    })

    return () => subscription.subscription.unsubscribe()
  }, [code])

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      new_password: "",
      confirm_password: "",
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const { error } = await createClient().auth.updateUser({
        password: data.new_password,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      showSuccessToast("Password updated successfully")
      form.reset()
      await createClient().auth.signOut({ scope: "local" })
      router.push("/login")
    },
    onError: (err: Error) => {
      showErrorToast(err.message)
    },
  })

  const onSubmit = (data: FormData) => {
    if (mutation.isPending) return
    mutation.mutate(data)
  }

  return (
    <AuthLayout>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">Reset Password</h1>
          </div>

          {linkState === "invalid" && (
            <p className="text-center text-sm text-destructive">
              Invalid or expired reset link. Please request a new one.
            </p>
          )}

          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="new_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      data-testid="new-password-input"
                      placeholder="New Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      data-testid="confirm-password-input"
                      placeholder="Confirm Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <LoadingButton
              type="submit"
              className="w-full"
              loading={mutation.isPending}
              disabled={linkState !== "ready"}
            >
              Reset Password
            </LoadingButton>
          </div>

          <div className="text-center text-sm">
            Remember your password?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Log in
            </Link>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
