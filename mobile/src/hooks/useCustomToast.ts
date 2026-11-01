import { toast } from "sonner-native"

export function useCustomToast() {
  return {
    error: (message: string) => toast.error(message),
  }
}
