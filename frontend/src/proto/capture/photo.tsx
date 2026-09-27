"use client"

import {
  Camera,
  Dumbbell,
  FileText,
  ImageIcon,
  Paperclip,
  Receipt,
  Sparkles,
  Tag,
  Upload,
  Utensils,
  X,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { finStore } from "../finance/store"
import { Chip } from "../ui/kit"
import type { PhotoHint } from "./data"
import { captureStore } from "./store"
import { BottomSheet } from "./ui"

// CAP-03 Photo sheet (real file/camera input + preview, hint chips, caption)
// and CAP-04 File attach sheet (statements → M4 import).

const HINTS: { v: PhotoHint; label: string; icon: typeof Camera }[] = [
  { v: "auto", label: "Auto", icon: Sparkles },
  { v: "meal", label: "Meal", icon: Utensils },
  { v: "receipt", label: "Receipt", icon: Receipt },
  { v: "label", label: "Label", icon: Tag },
  { v: "statement", label: "Statement", icon: FileText },
  { v: "whiteboard", label: "Gym board", icon: Dumbbell },
]

/** Downscale to a small JPEG data URL — the thread keeps only a thumbnail. */
function thumbnail(file: File, max = 360): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement("canvas")
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL("image/jpeg", 0.6))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve("")
    }
    img.src = url
  })
}

export function PhotoSheet({
  open,
  onOpenChange,
  hint: initialHint,
  onSend,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  hint?: string
  onSend: (p: { photo: string; hint: PhotoHint; caption: string }) => void
}) {
  const sendPhotos = captureStore.use((s) => s.settings.sendPhotos)
  const [hint, setHint] = useState<PhotoHint>("auto")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState("")
  const cam = useRef<HTMLInputElement>(null)
  const lib = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const h =
      HINTS.find((x) => x.v === initialHint)?.v ??
      (initialHint === "expense" ? "receipt" : "auto")
    setHint(h)
    setFile(null)
    setPreview(null)
    setCaption("")
  }, [open, initialHint])

  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const pickFile = (f?: File | null) => {
    if (f?.type.startsWith("image/")) setFile(f)
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Snap it"
      description="Meals, receipts, labels, gym boards. Tell me what it is if you know."
      footer={
        <button
          type="button"
          disabled={!file || !sendPhotos}
          onClick={async () => {
            if (!file) return
            const photo = await thumbnail(file)
            onSend({ photo, hint, caption })
            onOpenChange(false)
          }}
          className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
        >
          Send photo
        </button>
      }
    >
      {!sendPhotos && (
        <div className="mb-3 rounded-xl bg-warn/12 px-3 py-2 text-warn text-sm">
          Photo sending is off in{" "}
          <Link href="/capture/settings" className="underline">
            AI settings
          </Link>
          . Use text or quick add instead.
        </div>
      )}
      <div className="-mx-5 mb-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {HINTS.map((h) => (
          <Chip
            key={h.v}
            active={hint === h.v}
            onClick={() => setHint(h.v)}
            className="h-11"
          >
            <h.icon className="size-4" aria-hidden />
            {h.label}
          </Chip>
        ))}
      </div>
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl bg-muted">
          {/* biome-ignore lint/performance/noImgElement: local object URL preview */}
          <img
            src={preview}
            alt="Preview"
            className="max-h-64 w-full object-contain"
          />
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => setFile(null)}
            className="absolute top-2 right-2 grid size-11 place-items-center rounded-full bg-black/60 text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cam.current?.click()}
            className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-border border-dashed bg-muted/40 font-medium text-sm active:bg-muted"
          >
            <Camera className="size-7 text-primary" /> Take photo
          </button>
          <button
            type="button"
            onClick={() => lib.current?.click()}
            className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-border border-dashed bg-muted/40 font-medium text-sm active:bg-muted"
          >
            <ImageIcon className="size-7 text-primary" /> Library
          </button>
        </div>
      )}
      <input
        ref={cam}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <input
        ref={lib}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder={
          hint === "meal"
            ? "Add a caption, e.g. “half rice, 2 pcs adobo”"
            : "Add a caption (optional)"
        }
        className="mt-3 h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Receipts stay attached to their expense. Photos are only sent to the AI
        when you attach them.
      </p>
    </BottomSheet>
  )
}

export function FileSheet({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSend: (p: { fileName: string; account: string }) => void
}) {
  const accts = finStore.use((s) => s.accounts)
  const [account, setAccount] = useState("gcash")
  const [file, setFile] = useState<File | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) setFile(null)
  }, [open])
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Attach a statement"
      description="PDF, CSV or a screenshot. Finance's import does the matching — nothing changes until you review."
      footer={
        <button
          type="button"
          disabled={!file}
          onClick={() => {
            if (!file) return
            onSend({ fileName: file.name, account })
            onOpenChange(false)
          }}
          className="h-12 w-full rounded-xl bg-fin font-semibold text-background disabled:opacity-40"
        >
          Hand off to Finance import
        </button>
      }
    >
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border border-dashed p-4 text-left",
          file ? "border-fin/40 bg-fin/5" : "border-border bg-muted/40",
        )}
      >
        {file ? (
          <FileText className="size-8 text-fin" />
        ) : (
          <Upload className="size-8 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className="truncate font-medium">
            {file ? file.name : "Choose a file"}
          </div>
          <div className="text-muted-foreground text-xs">
            {file
              ? `${Math.max(1, Math.round(file.size / 1024))} KB`
              : "GCash / Maya / BPI statements work best"}
          </div>
        </div>
        <Paperclip className="ml-auto size-4 text-muted-foreground" />
      </button>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.csv,image/*"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="mt-4 mb-1.5 font-medium text-muted-foreground text-xs">
        This is a statement for
      </div>
      <div className="flex flex-wrap gap-1.5">
        {accts
          .filter((a) => !a.archived && a.type !== "investment")
          .map((a) => (
            <Chip
              key={a.id}
              accent="fin"
              active={account === a.id}
              onClick={() => setAccount(a.id)}
              className="h-11"
            >
              {a.name}
            </Chip>
          ))}
      </div>
    </BottomSheet>
  )
}
