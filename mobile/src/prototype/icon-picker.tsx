// The one icon picker for records a person names themselves: habits,
// routines and money categories. A form shows `IconField` (a row of
// suggestions for the name being typed, plus "All icons"); that opens
// `IconPickerSheet`, which browses the whole catalogue by search, by area
// or from recent picks.
import { Check, LayoutGrid, Search, X } from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import {
  ALL_ICONS,
  findIcon,
  ICON_SECTIONS,
  type IconEntry,
  iconKey,
  iconLabel,
} from "./icons/catalog"
import {
  closestIcons,
  recentIcons,
  rememberIcon,
  searchIcons,
  suggestIcons,
} from "./icons/search"
import { feel } from "./motion"
import { Copy, Tap } from "./native-kit"
import { type Accent, fonts, useTheme } from "./theme"
import { Sheet } from "./ui"

const GAP = 6,
  MIN_CELL = 44,
  HEAD = 40,
  SIDE = 16
const same = (a: string, b: string) => iconKey(a) === iconKey(b)
const VIEWABLE = { itemVisiblePercentThreshold: 10 }
const ICON_IDS = new Set([
  "suggested",
  "recent",
  ...ICON_SECTIONS.map((s) => s.id),
])

function IconCell({
  icon,
  size,
  selected,
  accent,
  onPress,
}: {
  icon: IconEntry
  size: number
  selected: boolean
  accent: Accent
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      role="radio"
      selected={selected}
      label={icon.name}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? `${t[accent]}2e` : t.soft,
        borderWidth: 2,
        borderColor: selected ? t.text : "transparent",
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: Math.round(size * 0.5), lineHeight: size * 0.66 }}
      >
        {icon.emoji}
      </Text>
      {selected && (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: t.text,
            borderWidth: 2,
            borderColor: t.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={10} strokeWidth={3} color={t.bg} />
        </View>
      )}
    </Tap>
  )
}

type Row =
  | { kind: "head"; key: string; section: string; title: string }
  | { kind: "icons"; key: string; section: string; icons: IconEntry[] }
  | { kind: "note"; key: string; section: string; text: string }
const chunk = (icons: IconEntry[], cols: number, section: string): Row[] =>
  Array.from({ length: Math.ceil(icons.length / cols) }, (_, n) => ({
    kind: "icons" as const,
    key: `${section}-${n}`,
    section,
    icons: icons.slice(n * cols, n * cols + cols),
  }))

/** The full catalogue in a sheet. Each tap applies at once (the form shows
 * it), gives a light tap, and the sheet stays open to compare. */
export function IconPickerSheet({
  open,
  onClose,
  value,
  onChange,
  name = "",
  accent,
  fallback,
  title = "Choose an icon",
}: {
  open: boolean
  onClose: () => void
  value: string
  onChange: (emoji: string) => void
  /** The record's name as typed: ranks the Suggested row. */
  name?: string
  accent: Accent
  /** What Suggested shows when the name matches nothing. */
  fallback: string[]
  title?: string
}) {
  const t = useTheme(),
    reduced = useReducedMotion(),
    window = useWindowDimensions(),
    [width, setWidth] = useState(window.width - SIDE * 2),
    [query, setQuery] = useState(""),
    [active, setActive] = useState("suggested"),
    recent = recentIcons.use((s) => s.icons),
    list = useRef<FlatList<Row>>(null),
    chips = useRef<ScrollViewInstance>(null),
    chipX = useRef<Record<string, number>>({}),
    opened = useRef(value),
    // FlatList takes one callback for its lifetime; the chips follow the
    // first area in view while browsing.
    onViewable = useRef(
      ({ viewableItems }: { viewableItems: { item: unknown }[] }) => {
        const top = viewableItems[0]?.item as Row | undefined
        if (top && ICON_IDS.has(top.section)) setActive(top.section)
      },
    )
  // Each opening starts from the top, unsearched, and remembers what was
  // picked once it closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: per opening only
  useEffect(() => {
    if (open) {
      opened.current = value
      setQuery("")
      setActive("suggested")
    }
  }, [open])
  const close = () => {
    if (!same(value, opened.current)) rememberIcon(value)
    onClose()
  }
  const cols = Math.min(
      8,
      Math.max(4, Math.floor((width + GAP) / (MIN_CELL + GAP))),
    ),
    cell = (width - GAP * (cols - 1)) / cols,
    rowHeight = cell + GAP,
    searching = query.trim().length > 0
  const suggested = useMemo(
      () => suggestIcons(name, fallback, cols * 2),
      [name, fallback, cols],
    ),
    recents = useMemo(
      () =>
        recent
          .map((e) => findIcon(e))
          .filter((i): i is IconEntry => !!i)
          .slice(0, cols * 2),
      [recent, cols],
    )
  const browse = useMemo(() => {
    const out: Row[] = []
    const add = (section: string, title: string, icons: IconEntry[]) => {
      if (!icons.length) return
      out.push({ kind: "head", key: `h-${section}`, section, title })
      out.push(...chunk(icons, cols, section))
    }
    add(
      "suggested",
      name.trim() ? `Suggested for “${name.trim()}”` : "Suggested",
      suggested,
    )
    add("recent", "Recent", recents)
    for (const s of ICON_SECTIONS) add(s.id, s.title, s.icons)
    return out
  }, [cols, name, suggested, recents])
  const found = useMemo(() => {
    if (!searching) return []
    const hits = searchIcons(query)
    if (hits.length)
      return [
        {
          kind: "head" as const,
          key: "h-found",
          section: "found",
          title: `${hits.length} ${hits.length === 1 ? "icon" : "icons"}`,
        },
        ...chunk(hits, cols, "found"),
      ]
    const near = closestIcons(query, cols * 2)
    const rest = suggested.filter((i) => !near.includes(i))
    return [
      {
        kind: "note" as const,
        key: "none",
        section: "found",
        text: near.length
          ? `No icons match “${query.trim()}”. The closest:`
          : `No icons match “${query.trim()}”. Try one word, like run or food.`,
      },
      ...chunk(near, cols, "near"),
      ...(rest.length
        ? [
            {
              kind: "head" as const,
              key: "h-near-suggested",
              section: "near",
              title: "Suggested",
            },
            ...chunk(rest, cols, "near-suggested"),
          ]
        : []),
    ]
  }, [searching, query, cols, suggested])
  const rows = searching ? found : browse
  const offsets = useMemo(() => {
    let y = 0
    return rows.map((r) => {
      const at = y
      y += r.kind === "head" ? HEAD : rowHeight
      return at
    })
  }, [rows, rowHeight])
  const pick = (emoji: string) => {
    feel.tap()
    onChange(emoji)
  }
  const jump = (section: string) => {
    const index = rows.findIndex(
      (r) => r.kind === "head" && r.section === section,
    )
    if (index < 0) return
    setActive(section)
    list.current?.scrollToIndex({ index, animated: !reduced })
  }
  const chipList = [
    { id: "suggested", title: "Suggested" },
    ...(recents.length ? [{ id: "recent", title: "Recent" }] : []),
    ...ICON_SECTIONS.map((s) => ({ id: s.id, title: s.title })),
  ]
  useEffect(() => {
    const x = chipX.current[active]
    if (x !== undefined)
      chips.current?.scrollTo({ x: Math.max(0, x - 48), animated: !reduced })
  }, [active, reduced])
  const current = findIcon(value)
  return (
    <Sheet title={title} open={open} onClose={close} fill>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          accessible
          accessibilityLabel={`Selected icon: ${iconLabel(value)}`}
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            backgroundColor: `${t[accent]}2e`,
            borderWidth: 2,
            borderColor: t[accent],
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 34 }}>
            {value}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {/* Capped so large text leaves room for the grid below. */}
          <Copy size={16} weight="medium" lines={2} maxScale={1.4}>
            {current?.name ?? "Your icon"}
          </Copy>
          <Copy size={13} muted lines={1} maxScale={1.4}>
            {current
              ? ICON_SECTIONS.find((s) => s.id === current.section)?.title
              : "Saved before this list"}
          </Copy>
        </View>
        <Tap
          label="Done"
          onPress={close}
          style={{
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            justifyContent: "center",
          }}
        >
          <Copy size={15} weight="medium" maxScale={1.4}>
            Done
          </Copy>
        </Tap>
      </View>
      <View
        style={{
          marginTop: 12,
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: t.card,
        }}
      >
        <Search size={18} color={t.muted} strokeWidth={1.75} />
        <TextInput
          accessibilityLabel="Search icons"
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${ALL_ICONS.length} icons, like gym or coffee`}
          placeholderTextColor={t.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={{
            flex: 1,
            paddingVertical: 10,
            fontSize: 15,
            fontFamily: fonts.body,
            color: t.text,
          }}
        />
        {searching && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery("")}
            hitSlop={8}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={14} color={t.muted} strokeWidth={2} />
            </View>
          </Pressable>
        )}
      </View>
      {!searching && (
        <ScrollView
          ref={chips}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ marginHorizontal: -SIDE, marginTop: 8, flexGrow: 0 }}
          contentContainerStyle={{
            gap: 6,
            paddingHorizontal: SIDE,
            paddingVertical: 2,
          }}
        >
          {chipList.map((c) => {
            const on = c.id === active
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityHint="Jumps to this group"
                onLayout={(e) => {
                  chipX.current[c.id] = e.nativeEvent.layout.x
                }}
                onPress={() => jump(c.id)}
                style={{
                  minHeight: 36,
                  paddingHorizontal: 12,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: on ? t.text : t.line,
                  backgroundColor: on ? t.text : t.card,
                  justifyContent: "center",
                }}
              >
                <Text
                  maxFontSizeMultiplier={1.4}
                  style={{
                    fontSize: 13,
                    fontFamily: fonts.medium,
                    color: on ? t.bg : t.text,
                  }}
                >
                  {c.title}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}
      <View
        style={{ flex: 1, marginTop: 4 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={14}
          windowSize={7}
          getItemLayout={(_, index) => ({
            index,
            offset: offsets[index] ?? 0,
            length: rows[index]?.kind === "head" ? HEAD : rowHeight,
          })}
          onScrollToIndexFailed={({ index }) =>
            list.current?.scrollToOffset({
              offset: offsets[index] ?? 0,
              animated: false,
            })
          }
          viewabilityConfig={VIEWABLE}
          onViewableItemsChanged={onViewable.current}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
          renderItem={({ item }) =>
            item.kind === "icons" ? (
              <View
                style={{ flexDirection: "row", gap: GAP, height: rowHeight }}
              >
                {item.icons.map((i) => (
                  <IconCell
                    key={i.emoji}
                    icon={i}
                    size={cell}
                    accent={accent}
                    selected={same(i.emoji, value)}
                    onPress={() => pick(i.emoji)}
                  />
                ))}
              </View>
            ) : item.kind === "head" ? (
              <View style={{ height: HEAD, justifyContent: "center" }}>
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 13,
                    fontFamily: fonts.medium,
                    color: t.muted,
                  }}
                >
                  {item.title}
                </Text>
              </View>
            ) : (
              <View style={{ height: rowHeight, justifyContent: "center" }}>
                <Text
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.2}
                  style={{
                    fontSize: 14,
                    lineHeight: 20,
                    fontFamily: fonts.body,
                    color: t.muted,
                  }}
                >
                  {item.text}
                </Text>
              </View>
            )
          }
        />
      </View>
    </Sheet>
  )
}

/** A form's icon row: "All icons" for the full picker (first, so it is
 * never scrolled out of sight), then the current pick and what suits the
 * name so far. */
export function IconField({
  value,
  onChange,
  name = "",
  accent,
  fallback,
  count = 8,
  inset = SIDE,
}: {
  value: string
  onChange: (emoji: string) => void
  name?: string
  accent: Accent
  fallback: string[]
  count?: number
  /** The form's side padding: the row scrolls edge to edge. */
  inset?: number
}) {
  const t = useTheme(),
    [open, setOpen] = useState(false),
    picks = useMemo(() => {
      const top = suggestIcons(name, fallback, count),
        mine = findIcon(value)
      // The current icon stays in view, first, even when the name moves on.
      return mine
        ? [mine, ...top.filter((i) => i !== mine)].slice(0, count)
        : top
    }, [name, fallback, count, value])
  const custom = !findIcon(value)
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ marginHorizontal: -inset, flexGrow: 0 }}
        contentContainerStyle={{
          paddingHorizontal: inset,
          paddingVertical: 4,
          gap: GAP + 2,
        }}
      >
        <Tap
          label={`All icons, ${ALL_ICONS.length} to choose from`}
          onPress={() => setOpen(true)}
          style={{
            height: MIN_CELL,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <LayoutGrid size={18} color={t.text} strokeWidth={1.75} />
          <Copy size={14} weight="medium" maxScale={1.3}>
            All icons
          </Copy>
        </Tap>
        {custom && (
          <View
            accessible
            accessibilityLabel={`Selected icon: ${value}`}
            style={{
              width: MIN_CELL,
              height: MIN_CELL,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: t.text,
              backgroundColor: `${t[accent]}2e`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 20 }}>
              {value}
            </Text>
          </View>
        )}
        {picks.map((i) => (
          <IconCell
            key={i.emoji}
            icon={i}
            size={MIN_CELL}
            accent={accent}
            selected={same(i.emoji, value)}
            onPress={() => {
              feel.tap()
              onChange(i.emoji)
              rememberIcon(i.emoji)
            }}
          />
        ))}
      </ScrollView>
      <IconPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={onChange}
        name={name}
        accent={accent}
        fallback={fallback}
      />
    </>
  )
}
