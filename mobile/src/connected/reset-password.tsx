import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useRef } from "react"
import { Controller, useForm } from "react-hook-form"
import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useCustomToast } from "@/hooks/useCustomToast"
import { getSupabase } from "@/lib/supabase"
import { confirmPasswordRules, handleError, passwordRules } from "@/lib/utils"

interface ResetForm {
  new_password: string
  confirm_password: string
}

export default function ResetPasswordScreen() {
  const toast = useCustomToast()
  const router = useRouter()
  // The recovery deep-link arrives as fastapimobile://reset-password?code=...
  // (expo-router surfaces the query param here). Exchange it for a session so
  // updateUser() below has an authenticated context.
  const { code } = useLocalSearchParams<{ code?: string }>()
  // Exchange each code once; useCustomToast() returns a fresh object per
  // render, so guard against the effect re-firing on unrelated re-renders.
  const exchangedCode = useRef<string | null>(null)

  useEffect(() => {
    if (!code || exchangedCode.current === code) return
    exchangedCode.current = code
    getSupabase()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) toast.error(handleError(error))
      })
      .catch((err) => toast.error(handleError(err)))
  }, [code, toast])

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    defaultValues: { new_password: "", confirm_password: "" },
  })

  const onSubmit = async ({ new_password }: ResetForm) => {
    try {
      // Requires an active session (recovery link or logged-in user).
      const { error } = await getSupabase().auth.updateUser({
        password: new_password,
      })
      if (error) throw error
      toast.success("Password reset. Please log in.")
      router.replace("/login")
    } catch (err) {
      toast.error(handleError(err))
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-6 px-6">
        <Text className="text-3xl font-bold">Reset Password</Text>

        <Controller
          control={control}
          name="new_password"
          rules={passwordRules()}
          render={({ field: { onChange, value } }) => (
            <FormField
              label="New password"
              error={errors.new_password?.message}
            >
              <Input
                value={value}
                onChangeText={onChange}
                placeholder="********"
                secureTextEntry
              />
            </FormField>
          )}
        />

        <Controller
          control={control}
          name="confirm_password"
          rules={confirmPasswordRules(() => getValues())}
          render={({ field: { onChange, value } }) => (
            <FormField
              label="Confirm password"
              error={errors.confirm_password?.message}
            >
              <Input
                value={value}
                onChangeText={onChange}
                placeholder="********"
                secureTextEntry
              />
            </FormField>
          )}
        />

        <Button
          label={isSubmitting ? "Resetting..." : "Reset Password"}
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
        />
      </View>
    </SafeAreaView>
  )
}
