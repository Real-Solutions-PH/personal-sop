# Button

The action button. **One filled button per screen**; the rest are outline or text.

| Variant | Look | Use |
|---|---|---|
| Primary | `primary` fill, `primary-foreground` text | The one main action: "Add expense", "Start workout" |
| Outline | transparent, 1 pt `input` border, `foreground` text | Secondary actions: "Edit", "Add set" |
| Text | `primary` text only | Dismissive or minor actions: "Not now", "Undo" |
| Danger | `destructive` text only | Destructive actions, always confirmed or undoable |

Height 48 pt (small 36), padding 12 × 20, `radius-control`, label in `control` (Geist Medium 15). Pressed: opacity 0.72, no bounce. Disabled: 0.4 opacity. Labels say exactly what happens, and may carry the value: "Save weigh-in · 72.4 kg". Module colours never fill a button.
