# ADR-0030 — Icons people pick for their own records are emoji

- **Date:** 2026-11-02
- **Status:** accepted
- **Deciders:** owner (asked for a larger icon set, 2026-11-02)
- **Amends:** [ADR-0019](0019-unfurl-brand-and-design-system.md), the rule "Icons are lucide outlines … never emoji"

## Context

ADR-0019 says the interface uses one icon family, lucide outlines, and never emoji. Since the prototype, though, the icon a person picks for a habit, a routine or a money category has been an emoji, stored as text on the record (`icon`, up to 32 characters on the server, 8 when Fern sets it). The pickers offered 20 habit icons and 18 category icons. The owner asked for several hundred, grouped by the areas Unfurl tracks.

The stored text is used as plain text in more places than the app's own views:

- routine notifications and the Live Activity line (`🌅 Morning routine · Stretch (2/5)`);
- category chips and option labels (`🍽️ Food`);
- the web app, Fern's replies, and the server's seeded categories.

A lucide icon name such as `dumbbell` would render as the word in every one of those places, and would need a renderer and a migration for every saved record.

## Decision

- **A record's own icon is an emoji**, picked from one catalogue in `mobile/src/prototype/icons/catalog.ts`: about 500 icons in 16 areas, each with a name (its VoiceOver label) and the words search and suggestions match.
- **The lucide-only rule still governs the interface**: buttons, tabs, rows, the picker's own controls (search, clear, "All icons", the selected check). Emoji appear only as the person's content.
- **No second icon font.** Emoji come from the system font.
- **Nothing saved is renamed or dropped.** Every emoji the app, the web app, the server seeds or Fern ever offered stays in the catalogue, guarded by `mobile/src/prototype/__tests__/icon-catalog.test.ts`. An icon that predates the catalogue still renders and shows as selected.
- Task lists keep their 9 lucide icons for now. The server enforces them with a database check, `ck_task_list_icon`. Widening that set means a migration and a web change, so it is a separate piece of work.

## Constitution clause deviated from

None (this amends a brand rule, not the engineering constitution).

## Consequences

**Positive:**
- The same icon reads the same in the app, notifications, the web app and Fern's replies, with no migration.
- Several hundred choices, found by name, by synonym ("gym", "coffee") or by the record's name as it is typed.

**Negative:**
- Emoji are drawn by the operating system, so they look slightly different on iOS, Android and the web. Icons from Emoji 14 (2021) may show as boxes on Android 11 and older.

**Follow-ups:**
- Widen the task-list icon set (server check constraint, schema, web and mobile maps).
