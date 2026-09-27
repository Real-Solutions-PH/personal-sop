"use client"

import { Bot, Dumbbell, LayoutList, RotateCcw, Target } from "lucide-react"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Btn,
  Card,
  Chip,
  Row,
  Screen,
  SectionTitle,
  Segmented,
} from "../../ui/kit"
import { resetFitness, updateSettings } from "../actions"
import { kg, weeklyRate } from "../calc"
import { useFit } from "../store"
import { Pill, toast } from "../ui"
import { GoalSheet } from "./body"

// FIT-22 Fitness settings

export function SettingsScreen() {
  const s = useFit()
  const st = s.settings
  const [goal, setGoal] = useState(false)
  return (
    <Screen back="/fitness" title="Fitness settings">
      <SectionTitle>Training</SectionTitle>
      <Card className="space-y-4">
        <div>
          <div className="mb-1.5 text-sm">Units</div>
          <Segmented
            value={st.units}
            onChange={(v) => updateSettings({ units: v })}
            options={[
              { value: "kg", label: "kg" },
              { value: "lb", label: "lb" },
            ]}
          />
          {st.units === "lb" && (
            <div className="mt-1 text-muted-foreground text-xs">
              Stored in kg; the prototype still displays kg.
            </div>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-sm">Default rest</div>
          <div className="flex flex-wrap gap-2">
            {[60, 90, 120, 150, 180].map((n) => (
              <Chip
                key={n}
                active={st.restSec === n}
                accent="fit"
                onClick={() => updateSettings({ restSec: n })}
              >
                {n < 120 ? `${n}s` : `${n / 60}m`.replace(".5m", "m30")}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">Weekly session target</div>
            <div className="text-muted-foreground text-xs">
              Missed sessions = target − done
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Fewer"
              onClick={() =>
                updateSettings({
                  weeklyTarget: Math.max(1, st.weeklyTarget - 1),
                })
              }
              className="grid size-9 place-items-center rounded-lg bg-muted"
            >
              −
            </button>
            <span className="num w-6 text-center font-semibold">
              {st.weeklyTarget}
            </span>
            <button
              type="button"
              aria-label="More"
              onClick={() =>
                updateSettings({
                  weeklyTarget: Math.min(7, st.weeklyTarget + 1),
                })
              }
              className="grid size-9 place-items-center rounded-lg bg-muted"
            >
              +
            </button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm">How weight goes up</div>
          <Segmented
            value={st.progression}
            onChange={(v) => updateSettings({ progression: v })}
            options={[
              { value: "double", label: "Reps, then weight" },
              { value: "linear", label: "Weight every session" },
            ]}
          />
          <div className="mt-1 text-muted-foreground text-xs">
            {st.progression === "double"
              ? "Hit the top of the rep range on every set → add weight. Otherwise add a rep."
              : "Add one increment every session."}
          </div>
        </div>
      </Card>

      <SectionTitle>Body</SectionTitle>
      <Card className="space-y-3">
        <Row
          onClick={() => setGoal(true)}
          title="Goal"
          subtitle={`${{ cut: "lose weight", maintain: "maintain", bulk: "gain weight" }[st.goalDirection]}${st.goalWeight ? ` → ${kg(st.goalWeight)}` : ""}`}
          right={
            <Pill tone="fit">
              <span className="capitalize">
                {
                  {
                    cut: "lose weight",
                    maintain: "maintain",
                    bulk: "gain weight",
                  }[st.goalDirection]
                }
              </span>
            </Pill>
          }
          className="capitalize"
        />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">Weigh-in reminder</div>
            <div className="text-muted-foreground text-xs">
              Push only when installed to Home Screen
            </div>
          </div>
          <Input
            type="time"
            value={st.weighInReminder}
            onChange={(e) =>
              updateSettings({ weighInReminder: e.target.value })
            }
            className="h-9 w-28"
          />
        </div>
      </Card>

      <SectionTitle>AI for meals</SectionTitle>
      <Card className="space-y-3">
        <Segmented
          value={st.aiSource}
          onChange={(v) => updateSettings({ aiSource: v })}
          options={[
            { value: "builtin", label: "Built-in AI" },
            { value: "connector", label: "Claude connector" },
          ]}
        />
        {st.aiSource === "builtin" ? (
          <div className="text-muted-foreground text-xs">
            Photos and descriptions are estimated in-app. You confirm every
            estimate.
          </div>
        ) : (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Bot className="size-4" /> Claude connector{" "}
              <Pill>Coming soon</Pill>
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              Add this app as a custom connector in Claude; meals you log there
              land here as “via Claude”.
            </div>
            <Input
              disabled
              value="sop_live_••••••••••••"
              className="mt-2"
              aria-label="Connector token"
            />
          </div>
        )}
      </Card>

      <SectionTitle>Library</SectionTitle>
      <Card className="p-2">
        <Row
          href="/fitness/exercises"
          icon={<Dumbbell className="size-5 text-fit" />}
          title="Exercises"
          subtitle={`${s.exercises.filter((e) => !e.archived).length} active`}
        />
        <Row
          href="/fitness/templates"
          icon={<LayoutList className="size-5 text-fit" />}
          title="Templates"
          subtitle={s.templates.map((t) => t.name).join(" · ")}
        />
        <Row
          href="/fitness/nutrition/targets"
          icon={<Target className="size-5 text-fit" />}
          title="Macro targets"
          subtitle="Calories, protein, carbs, fat"
        />
      </Card>

      <Btn
        variant="ghost"
        className="mt-6 w-full text-muted-foreground"
        onClick={() => {
          resetFitness()
          toast("Fitness demo data restored")
        }}
      >
        <RotateCcw className="size-4" /> Reset fitness demo data
      </Btn>
      <GoalSheet
        open={goal}
        onOpenChange={setGoal}
        settings={st}
        current={weeklyRate(s)?.avg}
      />
    </Screen>
  )
}
