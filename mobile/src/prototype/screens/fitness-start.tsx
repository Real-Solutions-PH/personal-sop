import { type StartFrom, startWorkout } from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { Dumbbell, Plus, Repeat } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Sheet } from "../ui"
export function StartWorkoutSheet({ onClose }: { onClose: () => void }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    // Highlight today's scheduled workout; fall back to the round-robin
    // guess on a rest day or when no routine is set.
    next = C.scheduledTemplate(s) ?? C.nextTemplate(s),
    [err, setErr] = useState<{ reason: string; href?: string }>()
  const begin = (opts: StartFrom) => {
    const r = startWorkout(opts)
    if (!r.ok) {
      setErr(r)
      return
    }
    onClose()
    go("/fitness/workout")
  }
  return (
    <Sheet title="Start workout" open onClose={onClose}>
      <Copy size={14} muted>
        Sets prefill from last time, with the suggested weight or rep increase.
      </Copy>
      {err && (
        <Tap
          onPress={() => {
            if (err.href) {
              onClose()
              go(err.href)
            }
          }}
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: `${t.warn}26`,
          }}
        >
          <Copy size={14} style={{ color: t.warn }}>
            {err.reason}
            {err.href ? " Open it" : ""}
          </Copy>
        </Tap>
      )}
      {s.templates.map((tpl) => {
        const last = C.lastOfTemplate(s, tpl.id),
          sug = tpl.items[0]
            ? C.suggestion(s, tpl.items[0].exerciseId)
            : undefined,
          Icon = last ? Repeat : Dumbbell
        return (
          <Tap
            key={tpl.id}
            onPress={() =>
              begin(
                last
                  ? { from: "repeat", workoutId: last.id }
                  : { from: "template", templateId: tpl.id },
              )
            }
            style={{
              borderWidth: 1,
              borderColor: next?.id === tpl.id ? t.fit : t.line,
              backgroundColor: next?.id === tpl.id ? `${t.fit}1a` : t.card,
              padding: 12,
              borderRadius: 16,
            }}
          >
            <Line>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${t.fit}26`,
                }}
              >
                <Icon size={20} color={t.fit} />
              </View>
              <View style={{ flex: 1 }}>
                <Line style={{ gap: 8, flexWrap: "wrap" }}>
                  <Copy weight="medium">
                    {last ? "Repeat last " : ""}
                    {tpl.name}
                  </Copy>
                  {next?.id === tpl.id && (
                    <Copy size={11} style={{ color: t.fit }}>
                      Up next
                    </Copy>
                  )}
                </Line>
                <Copy size={12} muted>
                  {last ? C.relDay(last.startedAt) : "Template"} ·{" "}
                  {tpl.items.length} exercises
                  {!last
                    ? " · never done"
                    : sug && sug.kind !== "new"
                      ? ` · ${s.exercises
                          .find((e) => e.id === tpl.items[0].exerciseId)
                          ?.name.split(" ")
                          .slice(-2)
                          .join(" ")} ${sug.badge}`
                      : ""}
                </Copy>
              </View>
            </Line>
          </Tap>
        )
      })}
      <Tap onPress={() => begin({ from: "empty" })} style={{ padding: 12 }}>
        <Line>
          <Plus size={20} color={t.text} />
          <View>
            <Copy weight="medium">Empty workout</Copy>
            <Copy size={12} muted>
              Add exercises as you go
            </Copy>
          </View>
        </Line>
      </Tap>
      <Tap
        onPress={() => {
          onClose()
          go("/fitness/templates")
        }}
      >
        <Copy size={14} muted style={{ textAlign: "center" }}>
          Manage templates
        </Copy>
      </Tap>
    </Sheet>
  )
}
