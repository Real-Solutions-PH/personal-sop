import { Link } from "expo-router"
import { Controller, useForm } from "react-hook-form"
import { KeyboardAvoidingView, Platform, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useAuth } from "@/hooks/useAuth"
import { emailPattern } from "@/lib/utils"

interface LoginForm {
  username: string
  password: string
}

export default function LoginScreen() {
  const { login } = useAuth()
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    defaultValues: { username: "", password: "" },
  })

  const onSubmit = (data: LoginForm) => login.mutate(data)

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-center px-6"
      >
        <View className="gap-6">
          <Text className="text-3xl font-bold">Log In</Text>

          <Controller
            control={control}
            name="username"
            rules={{ required: "Email is required", pattern: emailPattern }}
            render={({ field: { onChange, value } }) => (
              <FormField label="Email" error={errors.username?.message}>
                <Input
                  value={value}
                  onChangeText={onChange}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </FormField>
            )}
          />

          <Controller
            control={control}
            name="password"
            rules={{ required: "Password is required" }}
            render={({ field: { onChange, value } }) => (
              <FormField label="Password" error={errors.password?.message}>
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
            label={login.isPending ? "Logging in..." : "Log In"}
            onPress={handleSubmit(onSubmit)}
            disabled={login.isPending}
          />

          <View className="flex-row justify-between">
            <Link href="/signup">
              <Text className="text-sm text-primary">Sign up</Text>
            </Link>
            <Link href="/recover-password">
              <Text className="text-sm text-primary">Forgot password?</Text>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
