import { sendCapture } from "@domain/capture/actions"
import type { PhotoHint } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { finStore } from "@domain/finance/store"
import { closeCapture } from "@domain/lib/capture"
import * as DocumentPicker from "expo-document-picker"
import {
  Camera,
  Dumbbell,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Receipt,
  Sparkles,
  Tag,
  Upload,
  Utensils,
  X,
} from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import { Image, ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import { pickPhoto } from "../media"
import { Copy, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Choices, Field, Sheet } from "../ui"

const hints = [
  { v: "auto", label: "Auto", I: Sparkles },
  { v: "meal", label: "Meal", I: Utensils },
  { v: "receipt", label: "Receipt", I: Receipt },
  { v: "label", label: "Label", I: Tag },
  { v: "statement", label: "Statement", I: FileText },
  { v: "whiteboard", label: "Gym board", I: Dumbbell },
] as const
export function CapturePhoto({
  initialHint,
  onClose,
  onSent,
}: {
  initialHint?: string
  onClose: () => void
  onSent?: (id: string) => void
}) {
  const t = useTheme(),
    allowed = captureStore.use((s) => s.settings.sendPhotos),
    [hint, setHint] = useState<PhotoHint>(
      hints.find((h) => h.v === initialHint)?.v ??
        (initialHint === "expense" ? "receipt" : "auto"),
    ),
    [photo, setPhoto] = useState<string | null>(null),
    [caption, setCaption] = useState("")
  return (
    <Sheet title="Snap it" open onClose={onClose}>
      {/* Sheet stacks its children flush; space the sections evenly. */}
      <View style={{ gap: 14 }}>
        <Copy size={14} muted>
          Meals, receipts, labels, gym boards. Tell me what it is if you know.
        </Copy>
        {!allowed && (
          <Tap
            onPress={() => {
              onClose()
              closeCapture()
              go("/capture/settings")
            }}
          >
            <Copy size={14} style={{ color: t.warn }}>
              Photo sending is off in AI settings. Use text or quick add
              instead.
            </Copy>
          </Tap>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          style={{ flexGrow: 0 }}
        >
          {hints.map((h) => (
            <Tap
              key={h.v}
              onPress={() => setHint(h.v)}
              style={{
                height: 44,
                borderRadius: 22,
                paddingHorizontal: 12,
                backgroundColor: hint === h.v ? t.primary : t.soft,
                justifyContent: "center",
              }}
            >
              <Line style={{ gap: 6 }}>
                <h.I size={16} color={hint === h.v ? t.onPrimary : t.text} />
                <Copy
                  size={14}
                  style={{ color: hint === h.v ? t.onPrimary : t.text }}
                >
                  {h.label}
                </Copy>
              </Line>
            </Tap>
          ))}
        </ScrollView>
        {photo ? (
          <View
            style={{
              backgroundColor: t.soft,
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <Image
              source={{ uri: photo }}
              accessibilityLabel="Preview"
              style={{ width: "100%", height: 256 }}
              resizeMode="contain"
            />
            <View style={{ position: "absolute", top: 8, right: 8 }}>
              <IconTap
                icon={X}
                label="Remove photo"
                background="#0009"
                color="#fff"
                onPress={() => setPhoto(null)}
              />
            </View>
          </View>
        ) : (
          <Line style={{ gap: 8 }}>
            {[
              { label: "Take photo", I: Camera, camera: true },
              { label: "Library", I: ImageIcon, camera: false },
            ].map((x) => (
              <Tap
                key={x.label}
                onPress={() =>
                  void pickPhoto(x.camera).then((v) => {
                    if (v) setPhoto(v)
                  })
                }
                style={{
                  flex: 1,
                  height: 128,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: t.line,
                  backgroundColor: t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <x.I size={28} color={t.primary} />
                <Copy size={14} weight="medium">
                  {x.label}
                </Copy>
              </Tap>
            ))}
          </Line>
        )}
        <Field
          label="Caption"
          value={caption}
          onChangeText={setCaption}
          placeholder={
            hint === "meal"
              ? "Add a caption, e.g. “half rice, 2 pcs adobo”"
              : "Add a caption (optional)"
          }
        />
        <Copy size={11} muted>
          Receipts stay attached to their expense. Photos are only sent to the
          AI when you attach them.
        </Copy>
        <Button
          disabled={!photo || !allowed}
          onPress={() => {
            if (!photo || !allowed) return
            const id = sendCapture({
              source: "photo",
              photo,
              hint,
              text: caption,
            })
            onClose()
            onSent?.(id)
          }}
        >
          Send photo
        </Button>
      </View>
    </Sheet>
  )
}
export function CaptureFile({
  onClose,
  onSent,
}: {
  onClose: () => void
  onSent?: (id: string) => void
}) {
  const t = useTheme(),
    allAccounts = finStore.use((s) => s.accounts),
    accounts = useMemo(
      () => allAccounts.filter((a) => !a.archived && a.type !== "investment"),
      [allAccounts],
    ),
    [account, setAccount] = useState(accounts[0]?.id ?? ""),
    [file, setFile] = useState<DocumentPicker.DocumentPickerAsset>()
  const pick = (closeIfNone: boolean) =>
    DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/csv", "image/*"],
      copyToCacheDirectory: true,
    })
      .then((r) => {
        if (!r.canceled) setFile(r.assets[0])
        else if (closeIfNone) onClose()
      })
      .catch(() => toast.error("Could not open the file picker"))
  // The paperclip means "pick a file": open the device's picker at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on open
  useEffect(() => {
    void pick(true)
  }, [])
  return (
    <Sheet title="Attach a statement" open onClose={onClose}>
      <View style={{ gap: 14 }}>
        <Copy size={14} muted>
          PDF, CSV or a screenshot. Finance's import does the matching — nothing
          changes until you review.
        </Copy>
        <Tap
          onPress={() => void pick(false)}
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: file ? t.fin : t.line,
            padding: 16,
            backgroundColor: t.soft,
          }}
        >
          <Line>
            {file ? (
              <FileText size={32} color={t.fin} />
            ) : (
              <Upload size={32} color={t.muted} />
            )}
            <View style={{ flex: 1 }}>
              <Copy weight="medium" lines={1}>
                {file?.name ?? "Choose a file"}
              </Copy>
              <Copy size={12} muted>
                {file
                  ? `${Math.max(1, Math.round((file.size ?? 0) / 1024))} KB`
                  : "GCash / Maya / BPI statements work best"}
              </Copy>
            </View>
            <Paperclip size={16} color={t.muted} />
          </Line>
        </Tap>
        <Choices
          label="This is a statement for"
          value={account}
          onChange={setAccount}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        <Button
          disabled={!file}
          onPress={() => {
            if (!file) return
            const id = sendCapture({
              source: "file",
              fileName: file.name,
              fileUri: file.uri,
              fileMime: file.mimeType,
              text: `Statement for ${accounts.find((a) => a.id === account)?.name ?? "my account"}`,
              hint: account,
            })
            onClose()
            onSent?.(id)
          }}
        >
          Hand off to Finance import
        </Button>
      </View>
    </Sheet>
  )
}
