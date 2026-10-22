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
  Receipt,
  Sparkles,
  Tag,
  Utensils,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { Image, ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import { pickPhoto, pickPhotos } from "../media"
import { Copy, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Field, Sheet } from "../ui"

const MAX_PHOTOS = 10
const hints = [
  { v: "auto", label: "Auto", I: Sparkles },
  { v: "meal", label: "Meal", I: Utensils },
  { v: "receipt", label: "Receipt", I: Receipt },
  { v: "label", label: "Label", I: Tag },
  { v: "statement", label: "Statement", I: FileText },
  { v: "whiteboard", label: "Gym board", I: Dumbbell },
] as const
// Which meal a meal photo is, one tap instead of typing it. It travels as
// the start of the caption ("Lunch: …"), which the server reads as the
// meal's label; a midnight snack is logged as a snack.
const MEALS = [
  "Breakfast",
  "Lunch",
  "Dinner",
  "Snack",
  "Midnight snack",
] as const
type MealType = (typeof MEALS)[number]
function mealForNow(d = new Date()): MealType {
  const h = d.getHours()
  if (h < 4 || h >= 22) return "Midnight snack"
  if (h < 11) return "Breakfast"
  if (h < 15) return "Lunch"
  if (h < 18) return "Snack"
  return "Dinner"
}
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
    [photos, setPhotos] = useState<string[]>([]),
    [meal, setMeal] = useState<MealType>(mealForNow()),
    [caption, setCaption] = useState("")
  const add = (more: string[]) =>
    setPhotos((cur) => [...cur, ...more].slice(0, MAX_PHOTOS))
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
        {hint === "meal" && (
          <View style={{ gap: 6 }}>
            <Copy size={12} muted>
              Which meal?
            </Copy>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
              style={{ flexGrow: 0 }}
            >
              {MEALS.map((m) => (
                <Tap
                  key={m}
                  label={`${m}${meal === m ? ", selected" : ""}`}
                  onPress={() => setMeal(m)}
                  style={{
                    height: 40,
                    borderRadius: 20,
                    paddingHorizontal: 14,
                    borderWidth: 1,
                    borderColor: meal === m ? t.nut : t.line,
                    backgroundColor: meal === m ? `${t.nut}26` : "transparent",
                    justifyContent: "center",
                  }}
                >
                  <Copy
                    size={14}
                    weight={meal === m ? "medium" : undefined}
                    style={{ color: meal === m ? t.nut : t.text }}
                  >
                    {m}
                  </Copy>
                </Tap>
              ))}
            </ScrollView>
          </View>
        )}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
            style={{ flexGrow: 0 }}
          >
            {photos.map((uri, i) => (
              <View
                key={`${i}-${uri.length}`}
                style={{
                  width: 112,
                  height: 140,
                  borderRadius: 14,
                  overflow: "hidden",
                  backgroundColor: t.soft,
                }}
              >
                <Image
                  source={{ uri }}
                  accessibilityLabel={`Photo ${i + 1}`}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
                <View style={{ position: "absolute", top: 4, right: 4 }}>
                  <IconTap
                    icon={X}
                    size={32}
                    label={`Remove photo ${i + 1}`}
                    background="#0009"
                    color="#fff"
                    onPress={() =>
                      setPhotos((cur) => cur.filter((_, j) => j !== i))
                    }
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        )}
        {photos.length < MAX_PHOTOS && (
          <Line style={{ gap: 8 }}>
            {[
              { label: "Take photo", I: Camera, camera: true },
              {
                label: photos.length ? "Add from library" : "Library",
                I: ImageIcon,
                camera: false,
              },
            ].map((x) => (
              <Tap
                key={x.label}
                onPress={() =>
                  x.camera
                    ? void pickPhoto(true).then((v) => v && add([v]))
                    : void pickPhotos(MAX_PHOTOS - photos.length).then(add)
                }
                style={{
                  flex: 1,
                  height: photos.length ? 64 : 128,
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
                <x.I size={photos.length ? 20 : 28} color={t.primary} />
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
          disabled={!photos.length || !allowed}
          onPress={() => {
            if (!photos.length || !allowed) return
            // One capture for all the photos: they are read together.
            const id = sendCapture({
              source: "photo",
              photo: photos[0],
              photos: photos.slice(1),
              hint,
              text:
                hint === "meal"
                  ? `${meal}: ${caption}`.replace(/:\s*$/, "")
                  : caption,
            })
            onClose()
            if (photos.length > 1) toast.success(`Sent ${photos.length} photos`)
            onSent?.(id)
          }}
        >
          {photos.length > 1 ? `Send ${photos.length} photos` : "Send photo"}
        </Button>
      </View>
    </Sheet>
  )
}
/** The paperclip: the device's file picker straight away, several files
 * at once, each sent as its own capture. No sheet in between: iOS cannot
 * present the picker over a sheet that is still opening. */
export async function attachFiles(onSent?: (id: string) => void) {
  let picked: DocumentPicker.DocumentPickerResult
  try {
    picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/csv", "image/*"],
      copyToCacheDirectory: true,
      multiple: true,
    })
  } catch {
    toast.error("Couldn't open your files. Try again.")
    return
  }
  if (picked.canceled || !picked.assets.length) return
  const account = finStore
    .get()
    .accounts.find((a) => !a.archived && a.type !== "investment")
  const ids = picked.assets.map((file) =>
    sendCapture({
      source: "file",
      fileName: file.name,
      fileUri: file.uri,
      fileMime: file.mimeType,
      text: `Attached ${file.name}`,
      hint: account?.id,
    }),
  )
  toast.success(
    ids.length > 1
      ? `Sent ${ids.length} files`
      : `Sent ${picked.assets[0].name}`,
  )
  onSent?.(ids[ids.length - 1])
}
