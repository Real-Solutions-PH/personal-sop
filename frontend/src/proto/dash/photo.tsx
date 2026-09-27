"use client"

import { Camera, ImageIcon, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Btn } from "../ui/kit"
import { Avatar } from "./stats"
import { dashStore, setProfilePhoto } from "./store"
import { BottomSheet } from "./ui"

// DSH-41 profile photo: pick or take → centre-crop → ~256px square JPEG data URL
// kept in the dash store (no upload anywhere). Falls back to initials.

const MAX_CHARS = 60_000

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Couldn't read that image"))
    }
    img.src = url
  })
}

/** Centre-crop to a square and shrink until the data URL fits the budget. */
export async function photoToDataUrl(file: File): Promise<string> {
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas unavailable")
  for (const size of [256, 192, 128]) {
    canvas.width = size
    canvas.height = size
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
    for (const q of [0.85, 0.75, 0.65, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", q)
      if (url.length <= MAX_CHARS) return url
    }
  }
  throw new Error("That image is too large")
}

/** Tappable avatar → Take photo / Choose photo / Remove photo. */
export function AvatarPhotoButton({ size = 88 }: { size?: number }) {
  const has = dashStore.use((s) => !!s.profile.photo)
  const [open, setOpen] = useState(false)
  const take = useRef<HTMLInputElement>(null)
  const choose = useRef<HTMLInputElement>(null)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    setOpen(false)
    if (!file) return
    try {
      setProfilePhoto(await photoToDataUrl(file))
      toast.success("Photo updated")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={has ? "Change profile photo" : "Add profile photo"}
        onClick={() => setOpen(true)}
        className="relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar size={size} />
        <span
          aria-hidden
          className="absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border-2 border-background bg-primary text-background"
        >
          <Camera className="size-4" />
        </span>
      </button>
      <input
        ref={take}
        type="file"
        accept="image/*"
        capture="user"
        onChange={onFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={choose}
        type="file"
        accept="image/*"
        onChange={onFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Profile photo"
        description="Stays on this device. Shows on share cards only if you turn it on."
      >
        <div className="space-y-2">
          <Btn
            variant="secondary"
            className="w-full justify-start"
            onClick={() => take.current?.click()}
          >
            <Camera className="size-4" /> Take photo
          </Btn>
          <Btn
            variant="secondary"
            className="w-full justify-start"
            onClick={() => choose.current?.click()}
          >
            <ImageIcon className="size-4" /> Choose photo
          </Btn>
          {has && (
            <Btn
              variant="danger"
              className="w-full justify-start"
              onClick={() => {
                setProfilePhoto(undefined)
                setOpen(false)
                toast("Photo removed")
              }}
            >
              <Trash2 className="size-4" /> Remove photo
            </Btn>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
