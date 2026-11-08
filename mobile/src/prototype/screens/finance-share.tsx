import { monthLabel } from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { ShieldCheck } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { Copy, Line } from "../native-kit"
import { type FinanceShares, financeShares } from "../productivity-share-calc"
import { fmt, pct } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  Change,
  ChartNote,
  cardInk,
  Delta,
  type Dot,
  Hero,
  LeafCal,
  Meters,
  ShareComposer,
  Stems,
  Sub,
  Title,
  Win,
  XBars,
} from "../share-kit"
import { useTheme } from "../theme"
import { Screen } from "../ui"

export type FinanceLayout = "savings" | "budgets" | "categories" | "nospend"
/** Every finance card figure is a share or a ratio: no amount is passed in,
 * so none can reach a card. */
export type FinanceCardData = FinanceShares

const plural = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`
/** The newest month with a savings rate (one with income), or -1. */
export const latestRate = (d: FinanceCardData) =>
  d.savings.map((x) => x.rate !== null).lastIndexOf(true)
/** A whole-percent value, signed as a change in points. */
const pts = (a: number, b: number) => Math.round((a - b) * 100)

export function FinanceCard({
  kind,
  width,
  look,
  data: d,
}: {
  kind: FinanceLayout
  width: number
  look: CardLook
  data: FinanceCardData
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    fin = c.area("fin")
  let body: ReactNode
  if (kind === "savings") {
    // The latest month with income leads: early in a month there is often
    // none yet, and a dash says nothing.
    const at = latestRate(d),
      now = at >= 0 ? d.savings[at].rate : null,
      prior = d.savings
        .slice(0, Math.max(0, at))
        .reverse()
        .find((x) => x.rate !== null),
      before = prior?.rate ?? null,
      current = at === d.savings.length - 1,
      known = d.savings
        .map((x) => x.rate)
        .filter((r): r is number => r !== null),
      best = now !== null && known.length > 1 && now >= Math.max(...known)
    body = (
      <>
        <Title>Savings rate</Title>
        <Hero
          value={pct(now)}
          unit={
            at >= 0
              ? `of income kept in ${monthLabel(d.savings[at].month, true).split(" ")[0]}`
              : "of income kept"
          }
          small
          delta={
            now !== null && before !== null ? (
              <Delta
                n={pts(now, before)}
                unit=" pts"
                suffix={`vs ${monthLabel(prior?.month ?? "")}`}
              />
            ) : undefined
          }
        />
        {now === null ? (
          <Sub>No income recorded in the last six months.</Sub>
        ) : now < 0 ? (
          <Sub bad>More went out than came in that month.</Sub>
        ) : best ? (
          <Win>Best month in the last six</Win>
        ) : !current ? (
          <Sub>{`No income recorded in ${monthLabel(d.month, true).split(" ")[0]} yet`}</Sub>
        ) : (
          <Sub>{`Average ${pct(known.reduce((a, b) => a + b, 0) / Math.max(1, known.length))} over six months`}</Sub>
        )}
        <Body end>
          <Stems
            values={d.savings.map((x) =>
              x.rate === null ? undefined : x.rate < 0 ? null : x.rate * 100,
            )}
            labels={d.savings.map((x) => monthLabel(x.month))}
            on={at >= 0 ? at : d.savings.length - 1}
            leaf={(v) => known.length > 1 && v >= Math.max(...known) * 100}
            format={(v) => `${fmt(Math.round(v))}%`}
            height={tall ? 130 : sq ? 76 : 100}
            color={fin}
            label="Savings rate each month"
          />
          <ChartNote
            left="Share of income kept each month"
            right={
              d.savings.some((x) => x.rate !== null && x.rate < 0)
                ? "✕ spent more than earned"
                : undefined
            }
          />
        </Body>
      </>
    )
  } else if (kind === "budgets") {
    const kept = d.budgets.filter((b) => b.used <= 1).length,
      onPace = d.budgets.filter((b) => b.used <= b.pace).length,
      over = d.budgets.length - kept
    body = (
      <>
        <Title>Budgets kept</Title>
        <Hero
          value={fmt(kept)}
          unit={`of ${plural(d.budgets.length, "budget")} within limit`}
          small
          delta={
            over > 0 ? (
              <Change good={false}>{`${fmt(over)} over`}</Change>
            ) : undefined
          }
        />
        {!d.budgets.length ? (
          <Sub>No budgets set this month.</Sub>
        ) : over === 0 && onPace === d.budgets.length ? (
          <Win>Every budget on pace</Win>
        ) : (
          <Sub bad={over > 0}>
            {`${plural(d.budgets.length - onPace, "budget")} ahead of the month's pace`}
          </Sub>
        )}
        <Body>
          <Meters
            rows={d.budgets.map((b) => ({
              name: b.name,
              value: b.used,
              label: `${pct(b.used)} used`,
              color: b.used > 1 ? c.bad : fin,
              mark: b.pace,
              bad: b.used > 1,
            }))}
          />
          {d.budgets.length > 0 && (
            <ChartNote left="The tick is how much of the month has gone" />
          )}
        </Body>
      </>
    )
  } else if (kind === "categories") {
    const top = d.shares[0]
    body = (
      <>
        <Title>Where spending went</Title>
        <Hero
          value={pct(top?.share ?? null)}
          unit={top ? `on ${top.name}` : "no spending yet"}
          small
        />
        {d.shares.length ? (
          <Sub>{`Across ${plural(d.shares.length, "category", "categories")} this month`}</Sub>
        ) : (
          <Sub>Nothing spent this month yet.</Sub>
        )}
        <Body>
          <XBars
            color={fin}
            rows={d.shares.map((x) => ({
              key: x.name,
              name: x.name,
              value: x.share,
              label: pct(x.share),
            }))}
          />
          {d.shares.length > 0 && (
            <ChartNote left="Share of this month's spending" />
          )}
        </Body>
      </>
    )
  } else {
    const days = d.noSpend.days,
      cells: Dot[] = days.map((x) => (x.free ? "on" : "off")),
      spent = days.length - d.noSpend.count
    body = (
      <>
        <Title>No-spend days</Title>
        <Hero
          value={fmt(d.noSpend.count)}
          unit={`of ${plural(days.length, "day")} this month`}
          small
        />
        {d.noSpend.streak >= 2 ? (
          <Win>{`${fmt(d.noSpend.streak)} in a row and counting`}</Win>
        ) : days.length && d.noSpend.count / days.length < 0.25 ? (
          <Sub
            bad
          >{`Spent on ${plural(spent, "day")} of ${fmt(days.length)}`}</Sub>
        ) : (
          <Sub>Days with nothing spent on wants</Sub>
        )}
        <Body end>
          {cells.length > 0 && (
            <LeafCal
              cells={cells}
              start={days[0]?.key}
              weeks={5}
              rowH={tall ? 24 : sq ? 15 : 20}
              color={fin}
            />
          )}
          <ChartNote left="A leaf for each day with no discretionary spending" />
        </Body>
      </>
    )
  }
  return (
    <CardFrame
      width={width}
      look={look}
      accent="fin"
      date={kind === "savings" ? "Last 6 months" : monthLabel(d.month, true)}
      foot="Shares and ratios only. No amounts."
    >
      {body}
    </CardFrame>
  )
}

export function FinanceShare() {
  const s = finStore.use((x) => x),
    t = useTheme(),
    [layout, setLayout] = useState<FinanceLayout>("savings")
  const data = financeShares(s),
    at = latestRate(data),
    now = at >= 0 ? data.savings[at].rate : null,
    kept = data.budgets.filter((b) => b.used <= 1).length
  const caption =
    layout === "savings"
      ? `Kept ${pct(now)} of my income${at >= 0 ? ` in ${monthLabel(data.savings[at].month, true).split(" ")[0]}` : ""} · Unfurl`
      : layout === "budgets"
        ? `${fmt(kept)} of ${fmt(data.budgets.length)} budgets within limit · Unfurl`
        : layout === "categories"
          ? `${pct(data.shares[0]?.share ?? null)} of my spending went to ${data.shares[0]?.name ?? "nothing yet"} · Unfurl`
          : `${fmt(data.noSpend.count)} no-spend days this month · Unfurl`
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={caption}
        items={(
          [
            { key: "savings", label: "Savings rate" },
            { key: "budgets", label: "Budgets" },
            { key: "categories", label: "Categories" },
            { key: "nospend", label: "No-spend days" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) => (
            <FinanceCard
              kind={item.key}
              width={width}
              look={look}
              data={data}
            />
          ),
        }))}
      >
        <Line style={{ gap: 6, paddingHorizontal: 4 }}>
          <ShieldCheck size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            Finance cards show percentages and ratios only. No amount, balance
            or account ever appears on a card.
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
