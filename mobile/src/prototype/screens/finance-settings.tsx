import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import {
  Archive,
  ChevronRight,
  Download,
  FolderTree,
  type LucideIcon,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import { exportCsv } from "../media"
import {
  Copy,
  Frame,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, confirm, Empty, Field, Screen, Sheet } from "../ui"
import { FinChip } from "./finance-projection"
export function FinanceDisclaimer({
  onClose,
  onAck,
}: {
  onClose: () => void
  onAck?: () => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    [scope, setScope] = useState(s.settings.aiScope)
  return (
    <Sheet title="Before you ask" open onClose={onClose}>
      <View style={{ gap: 8, paddingBottom: 8 }}>
        <Copy size={14}>
          The advisor is an AI that explains your own numbers, teaches concepts
          and suggests options. It is not licensed financial advice and never
          moves money.
        </Copy>
        <Copy size={14} muted>
          This prototype uses local sample answers. Choose the data scope for
          the advisor:
        </Copy>
        {(
          [
            {
              v: "aggregates",
              title: "Totals only (recommended)",
              detail:
                "Monthly totals by category, balances, scheduled payments. No payees or notes.",
            },
            {
              v: "records",
              title: "Individual transactions when needed",
              detail:
                "Individual transactions (payee, amount, date) for questions that need them. You'll see a chip when it's used.",
            },
          ] as const
        ).map((o) => (
          <Tap key={o.v} onPress={() => setScope(o.v)}>
            <Frame
              style={{
                padding: 12,
                borderColor: scope === o.v ? t.fin : t.line,
                backgroundColor: scope === o.v ? `${t.fin}1a` : t.card,
              }}
            >
              <Copy size={14} weight="medium">
                {o.title}
              </Copy>
              <Copy size={12} muted>
                {o.detail}
              </Copy>
            </Frame>
          </Tap>
        ))}
        <Button
          onPress={() => {
            A.updateSettings({ disclaimerAck: true, aiScope: scope })
            onClose()
            onAck?.()
          }}
        >
          I understand
        </Button>
        <Button tone="quiet" onPress={onClose}>
          Cancel
        </Button>
      </View>
    </Sheet>
  )
}
const caps = { textTransform: "uppercase", letterSpacing: 0.6 } as const
export function FinanceSettings() {
  const s = finStore.use((s) => s),
    st = s.settings,
    t = useTheme(),
    hidden = privacyStore.use((s) => s.hidden),
    [floor, setFloor] = useState(String(st.safetyFloor)),
    [ack, setAck] = useState(false)
  const row = (
    title: string,
    Icon: LucideIcon,
    onPress: () => void,
    detail?: string,
    iconColor: string = t.muted,
  ) => (
    <Tap onPress={onPress}>
      <Line style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
        <Icon size={20} color={iconColor} />
        <View style={{ flex: 1 }}>
          <Copy weight="medium">{title}</Copy>
          {detail && (
            <Copy size={14} muted>
              {detail}
            </Copy>
          )}
        </View>
        <ChevronRight size={16} color={t.muted} />
      </Line>
    </Tap>
  )
  const togg = (
    label: string,
    hint: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <Line style={{ paddingVertical: 12 }}>
      <View style={{ flex: 1 }}>
        <Copy size={14} weight="medium">
          {label}
        </Copy>
        <Copy size={12} muted>
          {hint}
        </Copy>
      </View>
      <Switch accent="fin" label={label} value={value} onChange={onChange} />
    </Line>
  )
  const chips = (children: React.ReactNode) => (
    // Bleed to the card edges so a clipped chip reads as "scroll for more"
    // and the last chip keeps the card's inner padding when scrolled to.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -16, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16 }}
    >
      <Line style={{ gap: 8 }}>{children}</Line>
    </ScrollView>
  )
  return (
    <Screen title="Finance settings">
      <View>
        <SectionHeading>Logging</SectionHeading>
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={12} muted weight="medium" style={caps}>
            Default account
          </Copy>
          {chips(
            s.accounts
              .filter((a) => !a.archived && a.type !== "investment")
              .map((a) => (
                <FinChip
                  key={a.id}
                  label={a.name}
                  active={st.defaultAccountId === a.id}
                  onPress={() => A.updateSettings({ defaultAccountId: a.id })}
                />
              )),
          )}
          <Copy size={11} muted>
            Pre-selected in quick-add and chat when you don't say which.
          </Copy>
          <Copy
            size={12}
            muted
            weight="medium"
            style={{ ...caps, marginTop: 8 }}
          >
            Month starts on day
          </Copy>
          <Line style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              tone="quiet"
              onPress={() =>
                A.updateSettings({
                  monthStartDay: Math.max(1, st.monthStartDay - 1),
                })
              }
            >
              −
            </Button>
            <Copy
              size={20}
              weight="displayMedium"
              style={{ width: 24, textAlign: "center" }}
            >
              {st.monthStartDay}
            </Copy>
            <Button
              tone="quiet"
              onPress={() =>
                A.updateSettings({
                  monthStartDay: Math.min(28, st.monthStartDay + 1),
                })
              }
            >
              +
            </Button>
            {[1, 15].map((v) => (
              <FinChip
                key={v}
                label={v === 1 ? "1st" : "15th (payday)"}
                active={st.monthStartDay === v}
                onPress={() => A.updateSettings({ monthStartDay: v })}
              />
            ))}
          </Line>
          <Copy size={11} muted>
            Budgets, reviews and stats use this cycle.
          </Copy>
          {togg(
            "Privacy mode",
            "Blurs every ₱ amount app-wide. Percentages stay visible.",
            hidden,
            togglePrivacy,
          )}
        </Frame>
        <SectionHeading>Forecast</SectionHeading>
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={12} muted weight="medium" style={caps}>
            Forecast length
          </Copy>
          <Segmented
            value={String(st.horizon)}
            onChange={(v) =>
              A.updateSettings({ horizon: Number(v) as 6 | 12 | 24 })
            }
            options={[6, 12, 24].map((v) => ({
              value: String(v),
              label: `${v} months`,
            }))}
          />
          {togg(
            "Include average everyday spending",
            "Recommended. Off shows scheduled payments only.",
            st.includeUnplanned,
            (includeUnplanned) => A.updateSettings({ includeUnplanned }),
          )}
          <Field
            label="Minimum balance ₱"
            value={floor ? Number(floor).toLocaleString("en-PH") : ""}
            onChangeText={(v) => setFloor(v.replace(/[^\d]/g, ""))}
            onBlur={() => A.updateSettings({ safetyFloor: Number(floor || 0) })}
            keyboardType="decimal-pad"
          />
          <Copy size={11} muted>
            What-ifs warn when your balance would dip below this.
          </Copy>
        </Frame>
        <SectionHeading>AI</SectionHeading>
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={12} muted weight="medium" style={caps}>
            Data the AI may see
          </Copy>
          <Segmented
            value={st.aiScope}
            onChange={(aiScope) => A.updateSettings({ aiScope })}
            options={[
              { value: "aggregates", label: "Totals only" },
              { value: "records", label: "Individual transactions" },
            ]}
          />
          <Copy size={11} muted>
            Applies to the advisor and statement reading.
          </Copy>
          {row(
            "Advisor disclaimer",
            ShieldCheck,
            () => setAck(true),
            st.disclaimerAck ? "Acknowledged" : "Not yet acknowledged",
            t.fin,
          )}
        </Frame>
        <SectionHeading>Statement matching</SectionHeading>
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={12} muted weight="medium" style={caps}>
            Remind me when an account hasn't been matched with a statement for
          </Copy>
          {chips(
            [14, 21, 30, 45].map((v) => (
              <FinChip
                key={v}
                label={`${v} days`}
                active={st.nudgeDays === v}
                onPress={() => A.updateSettings({ nudgeDays: v })}
              />
            )),
          )}
        </Frame>
        <SectionHeading>Data</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {row("Manage categories", FolderTree, () =>
            go("/finance/categories"),
          )}
          {row("Archived items", Archive, () => go("/finance/archived"))}
          {row(
            "Export transactions (CSV)",
            Download,
            () =>
              exportCsv(`finance-records-${dayKey()}.csv`, [
                [
                  "date",
                  "type",
                  "amount",
                  "account",
                  "to_account",
                  "category",
                  "payee",
                  "note",
                  "source",
                ],
                ...s.records.map((r) => [
                  C.recDay(r),
                  r.type,
                  String(r.amount),
                  s.accounts.find((a) => a.id === r.accountId)?.name ?? "",
                  s.accounts.find((a) => a.id === r.toAccountId)?.name ?? "",
                  s.categories.find((c) => c.id === r.categoryId)?.name ?? "",
                  r.payee ?? "",
                  r.note ?? "",
                  r.source,
                ]),
              ]),
            `${s.records.length} transactions`,
          )}
        </Frame>
        <SectionHeading>Prototype</SectionHeading>
        <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {row(
            "Reset demo data",
            RotateCcw,
            () => {
              A.resetFinance()
              toast("Finance demo data restored")
            },
            "90 days of sample history",
          )}
          {row("Start fresh (first-run setup)", Sparkles, () =>
            confirm(
              "Start fresh?",
              "Clears finance data so you can walk the first-run setup. Reset demo data brings it back.",
              () => {
                A.startFresh()
                go("/finance/setup")
              },
            ),
          )}
        </Frame>
      </View>
      {ack && <FinanceDisclaimer onClose={() => setAck(false)} />}
    </Screen>
  )
}
export function FinanceArchived() {
  const s = finStore.use((s) => s),
    groups = [
      {
        title: "Accounts",
        items: s.accounts
          .filter((a) => a.archived)
          .map((a) => ({
            id: a.id,
            name: a.name,
            restore: () => A.updateAccount(a.id, { archived: false }),
            remove: () => A.deleteAccount(a.id),
          })),
      },
      {
        title: "Categories",
        items: s.categories
          .filter((c) => c.archived)
          .map((c) => ({
            id: c.id,
            name: `${c.icon} ${c.name}`,
            restore: () => A.updateCategory(c.id, { archived: false }),
            remove: () => A.deleteCategory(c.id),
          })),
      },
      {
        title: "Budgets",
        items: s.budgets
          .filter((b) => b.archived)
          .map((b) => ({
            id: b.id,
            name: b.name,
            restore: () => A.updateBudget(b.id, { archived: false }),
            remove: () => {
              A.deleteBudget(b.id)
              return true
            },
          })),
      },
      {
        title: "Scheduled payments",
        items: s.planned
          .filter((p) => p.archived)
          .map((p) => ({
            id: p.id,
            name: p.name,
            restore: () => A.updatePlanned(p.id, { archived: false }),
            remove: () => A.deletePlanned(p.id),
          })),
      },
    ]
  return (
    <Screen title="Archived">
      {groups.every((g) => !g.items.length) ? (
        <Empty
          title="Nothing archived"
          detail="Archived accounts, categories, budgets and scheduled payments show up here."
        />
      ) : (
        <View>
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <View key={g.title}>
                <SectionHeading>{g.title}</SectionHeading>
                <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
                  {g.items.map((x) => (
                    <Line key={x.id} style={{ paddingVertical: 8, gap: 8 }}>
                      <Copy weight="medium" style={{ flex: 1 }}>
                        {x.name}
                      </Copy>
                      <Button small tone="quiet" onPress={x.restore}>
                        Restore
                      </Button>
                      <Button
                        small
                        tone="danger"
                        onPress={() =>
                          confirm(
                            `Delete ${x.name} permanently?`,
                            "This can't be undone. It's blocked if transactions still reference it.",
                            () => {
                              if (x.remove())
                                toast(`${x.name} deleted permanently`)
                              else
                                toast.error(
                                  `${x.name} still has transactions — it can only stay archived`,
                                )
                            },
                          )
                        }
                      >
                        Delete
                      </Button>
                    </Line>
                  ))}
                </Frame>
              </View>
            ))}
        </View>
      )}
    </Screen>
  )
}
