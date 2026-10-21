import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import {
  type CurrencyInfo,
  money,
  moneyCompact,
  useCurrency,
} from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import { useLocalSearchParams } from "expo-router"
import {
  Bot,
  History,
  Lock,
  Mic,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react-native"
import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Empty, Screen, Sheet } from "../ui"
import { AdvisorAnswer, type AdvisorQuestion, advisorQuestion } from "./finance"
import { FinPill } from "./finance-planned"
import { FinChip } from "./finance-projection"
import { FinanceDisclaimer } from "./finance-settings"

const suggested = (c: CurrencyInfo) => [
  `Can I afford a ${moneyCompact(45000, c)} laptop in December?`,
  `Finance a ${moneyCompact(30000, c)} phone at 0% for 12 months, or pay cash?`,
  "Where am I leaking money?",
  "How big should my emergency fund be?",
  "Should I start investing — MP2 or index funds?",
]
export function FinanceAdvisor() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    p = useLocalSearchParams<Record<string, string>>(),
    hidden = privacyStore.use((s) => s.hidden),
    SUGGESTED = suggested(useCurrency()),
    [thread, setThread] = useState<string | null>(null),
    [text, setText] = useState(""),
    [typing, setTyping] = useState(false),
    [threads, setThreads] = useState(false),
    [ack, setAck] = useState(!s.settings.disclaimerAck),
    active = s.threads.find((x) => x.id === thread),
    asked = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ask = useCallback(
    (q: string, question = advisorQuestion(q), override?: "records") => {
      if (!q.trim() || timer.current) return
      const id =
          thread ?? A.newThread(q.length > 40 ? `${q.slice(0, 40)}…` : q),
        scope = override ?? s.settings.aiScope
      setThread(id)
      A.pushMessage(id, { role: "user", text: q, scope })
      setTyping(true)
      setText("")
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        A.pushMessage(id, {
          role: "ai",
          text: JSON.stringify(question),
          answer:
            question.key === "leaks" && scope === "aggregates"
              ? "needs-scope"
              : question.key,
          scope,
        })
        setTyping(false)
        timer.current = null
      }, 900)
    },
    [thread, s.settings.aiScope],
  )
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  useEffect(() => {
    if (asked.current || !p.ask || !s.settings.disclaimerAck) return
    asked.current = true
    const key = p.ask === "runway" ? "emergency" : p.ask
    if (["afford", "review", "leaks", "emergency"].includes(key)) {
      const amount = Number(p.amount) || undefined
      ask(
        key === "afford"
          ? `Can I afford ${p.name ?? "purchase"} for ${money(amount ?? 0)} in ${p.month ? C.monthLabel(p.month, true) : "a few months"}${p.mode === "inst" ? ` on ${p.n ?? 12}× 0%` : ""}?`
          : key === "review"
            ? "How did I do last month, and what should I change?"
            : key === "emergency"
              ? "How many months could my savings cover?"
              : "Where am I leaking money?",
        {
          key: key as AdvisorQuestion["key"],
          amount,
          month: p.month,
          n: p.mode === "inst" ? Number(p.n) || 12 : undefined,
          period: p.period,
        },
      )
    }
  }, [
    p.ask,
    p.amount,
    p.month,
    p.name,
    p.mode,
    p.n,
    p.period,
    s.settings.disclaimerAck,
    ask,
  ])
  const composer = (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        borderTopWidth: 1,
        borderColor: t.line,
        backgroundColor: t.bg,
      }}
    >
      {active && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Line style={{ gap: 8 }}>
            {SUGGESTED.slice(0, 4).map((q) => (
              <FinChip
                key={q}
                label={q.length > 30 ? `${q.slice(0, 30)}…` : q}
                onPress={() => ask(q)}
              />
            ))}
          </Line>
        </ScrollView>
      )}
      <Line style={{ gap: 8, marginTop: 8 }}>
        <TextInput
          accessibilityLabel="Ask the advisor"
          placeholder="Ask the advisor…"
          placeholderTextColor={t.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => ask(text.trim())}
          style={{
            height: 44,
            flex: 1,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: t.line,
            paddingHorizontal: 16,
            backgroundColor: t.card,
            fontSize: 16,
            fontFamily: fonts.body,
            color: t.text,
          }}
        />
        <IconTap
          icon={Mic}
          label="Voice"
          size={44}
          color={t.text}
          background={t.soft}
          onPress={() => go("/capture?mode=voice&hint=advisor")}
        />
        <IconTap
          icon={Send}
          label="Send"
          size={44}
          background={t.fin}
          color={t.bg}
          onPress={() => ask(text.trim())}
        />
      </Line>
      <Copy size={11} muted style={{ textAlign: "center", marginTop: 6 }}>
        AI commentary from your own data — not licensed financial advice.
      </Copy>
    </View>
  )
  return (
    <Screen
      title="Advisor"
      actions={
        <IconTap
          icon={History}
          label="Past threads"
          size={40}
          color={t.text}
          onPress={() => setThreads(true)}
        />
      }
      footer={s.settings.disclaimerAck ? composer : undefined}
    >
      {!s.settings.disclaimerAck ? (
        <Empty
          icon={Lock}
          title="Accept the advisor terms first"
          detail="The advisor explains your own numbers. It's not licensed financial advice and never moves money."
          action={<Button onPress={() => setAck(true)}>Read & accept</Button>}
        />
      ) : (
        <>
          <Line
            style={{
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderColor: t.line,
              gap: 8,
            }}
          >
            <Bot size={16} color={t.fin} />
            <Copy size={12} muted style={{ flex: 1 }}>
              AI accountant · uses your finance data
            </Copy>
            <Tap
              onPress={() =>
                A.updateSettings({
                  aiScope:
                    s.settings.aiScope === "records" ? "aggregates" : "records",
                })
              }
            >
              <FinPill tone={s.settings.aiScope === "records" ? "warn" : "fin"}>
                <ShieldCheck
                  size={12}
                  color={s.settings.aiScope === "records" ? t.warn : t.fin}
                />{" "}
                {s.settings.aiScope === "records"
                  ? "Individual transactions"
                  : "Totals only"}{" "}
                ⌄
              </FinPill>
            </Tap>
          </Line>
          {!active?.messages.length ? (
            <View style={{ paddingTop: 24 }}>
              <View style={{ alignItems: "center" }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    backgroundColor: `${t.fin}26`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Bot size={28} color={t.fin} />
                </View>
                <Copy weight="semibold" style={{ marginTop: 12 }}>
                  Ask about your money
                </Copy>
                <Copy
                  size={14}
                  muted
                  style={{ marginTop: 4, textAlign: "center" }}
                >
                  Lessons, feedback and options — worked from your numbers.
                </Copy>
              </View>
              <View style={{ marginTop: 20, gap: 8 }}>
                {SUGGESTED.map((q) => (
                  <Tap key={q} onPress={() => ask(q)}>
                    <Frame
                      style={{ paddingHorizontal: 16, paddingVertical: 12 }}
                    >
                      <Copy size={14}>{q}</Copy>
                    </Frame>
                  </Tap>
                ))}
              </View>
            </View>
          ) : (
            active.messages.map((m) => {
              let question: AdvisorQuestion | undefined
              try {
                question = JSON.parse(m.text)
              } catch {}
              return m.role === "user" ? (
                <View
                  key={m.id}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    borderRadius: 16,
                    borderBottomRightRadius: 4,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: t.fin,
                  }}
                >
                  <Copy size={14} style={{ color: t.bg }}>
                    {hidden ? "Content hidden for privacy" : m.text}
                  </Copy>
                </View>
              ) : (
                <Frame
                  key={m.id}
                  style={{ padding: 12, gap: 8, borderTopLeftRadius: 4 }}
                >
                  <Line style={{ gap: 6 }}>
                    <Bot size={14} color={t.fin} />
                    <Copy size={11} muted>
                      AI ·{" "}
                      {m.scope === "records"
                        ? "individual transactions"
                        : "totals only"}
                    </Copy>
                  </Line>
                  {question?.key ? (
                    <AdvisorAnswer
                      question={question}
                      scope={m.scope}
                      onAllow={() => {
                        A.updateSettings({ aiScope: "records" })
                        ask(
                          "Go ahead and use individual transactions for this one.",
                          question,
                          "records",
                        )
                      }}
                    />
                  ) : (
                    <Copy size={14}>{m.text}</Copy>
                  )}
                </Frame>
              )
            })
          )}
          {typing && (
            <Frame style={{ padding: 12, width: 64 }}>
              <Copy muted>•••</Copy>
            </Frame>
          )}
        </>
      )}
      <Sheet
        title="Past threads"
        open={threads}
        onClose={() => setThreads(false)}
      >
        {!s.threads.length && (
          <Copy
            size={14}
            muted
            style={{ paddingVertical: 24, textAlign: "center" }}
          >
            No threads yet.
          </Copy>
        )}
        {s.threads.map((x) => (
          <Line key={x.id}>
            <Tap
              onPress={() => {
                setThread(x.id)
                setThreads(false)
              }}
              style={{ flex: 1, paddingVertical: 12 }}
            >
              <Copy weight="medium">
                {hidden ? "Saved conversation" : x.title}
              </Copy>
              <Copy size={14} muted>
                {x.messages.length} messages ·{" "}
                {new Date(x.createdAt).toLocaleDateString("en-PH", {
                  month: "short",
                  day: "numeric",
                })}
              </Copy>
            </Tap>
            <IconTap
              icon={Trash2}
              label="Delete thread"
              onPress={() => {
                A.deleteThread(x.id)
                if (thread === x.id) setThread(null)
              }}
            />
          </Line>
        ))}
        <Button
          tone="quiet"
          onPress={() => {
            setThread(null)
            setThreads(false)
          }}
        >
          New thread
        </Button>
      </Sheet>
      {ack && <FinanceDisclaimer onClose={() => setAck(false)} />}
    </Screen>
  )
}
