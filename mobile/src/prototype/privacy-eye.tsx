// The one hide-amounts button. Every screen that offers it uses this, so
// they look the same and all flip the same saved setting.
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import { Eye, EyeOff } from "lucide-react-native"
import { toast } from "sonner-native"
import { IconTap } from "./native-kit"
import { useTheme } from "./theme"

export function PrivacyEye() {
  const t = useTheme()
  const hidden = privacyStore.use((s) => s.hidden)
  return (
    <IconTap
      size={44}
      icon={hidden ? EyeOff : Eye}
      label={hidden ? "Show amounts" : "Hide amounts"}
      color={hidden ? t.primary : t.muted}
      onPress={() => {
        togglePrivacy()
        toast(
          privacyStore.get().hidden
            ? "Amounts hidden everywhere"
            : "Amounts shown everywhere",
        )
      }}
    />
  )
}
