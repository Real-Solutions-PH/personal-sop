// Toasts as mobile snackbars: at the bottom above the tab bar (where the
// thumb is, clear of the header), one compact row with the action ("Undo")
// as a text button on the right. A confirmation shows no icon: the change
// itself is on screen; errors and warnings keep theirs.
import { Toaster } from "sonner-native"
import { fonts, useTheme } from "./theme"

export function AppToaster() {
  const t = useTheme()
  return (
    <Toaster
      position="bottom-center"
      // Clears the tab bar and Fern's button over it.
      offset={96}
      theme={t.dark ? "dark" : "light"}
      visibleToasts={2}
      gap={8}
      swipeToDismissDirection="left"
      icons={{ success: null, info: null }}
      toastOptions={{
        style: {
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 16,
        },
        toastContentStyle: { gap: 10, alignItems: "center" },
        // Message and action side by side; a description wraps below.
        textContainerStyle: {
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: 12,
        },
        titleStyle: {
          flexGrow: 1,
          flexShrink: 1,
          fontFamily: fonts.medium,
          fontWeight: "normal",
          fontSize: 14,
          lineHeight: 20,
          color: t.text,
        },
        descriptionStyle: {
          width: "100%",
          fontFamily: fonts.body,
          fontSize: 13,
          color: t.muted,
        },
        buttonsStyle: { marginTop: 0 },
        actionButtonStyle: {
          backgroundColor: "transparent",
          borderWidth: 0,
          paddingHorizontal: 4,
          paddingVertical: 4,
        },
        actionButtonTextStyle: {
          fontFamily: fonts.semibold,
          fontWeight: "normal",
          fontSize: 14,
          color: t.primary,
        },
      }}
    />
  )
}
