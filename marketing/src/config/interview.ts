// Unfurl's customer interview, as a self-serve form. Questions are taken from
// the branching interview kit (rsph-internal, projects/unfurl/research/
// 2026-11-interview-kit.md, 2026-11-08): a five-question screener sorts the
// visitor into one of five personas, that persona's module of past-behaviour
// questions runs, then a common close. Ids match the kit (S1, A3, Z1…) so
// answers can be coded against its log columns and themes.
//
// Web adaptations, all marked for Kai's sign-off in the PR:
// - S4 and S5 are split into single-answer parts (S4a/S4b, S5a/S5b/S5c).
// - The close keeps Z1 (first thing to check) and Z2 (try it on TestFlight,
//   via the optional email). Z3 (deposit) is left out because no deposit link
//   exists and the kit never quotes a price; Z4 (introduce someone) is left
//   out so the form never collects a third person's details.
// - Every module question is optional; any answer is better than none.

export type Choice = { value: string; label: string }

export type ScreenerQ = {
  id: string
  text: string
  kind: "single" | "multi"
  choices: Choice[]
}

export type ModuleQ = { id: string; text: string; probe: string }

export type Persona = "A" | "B" | "C" | "D" | "E"

export const SCREENER: ScreenerQ[] = [
  {
    id: "S1",
    text: "How old are you?",
    kind: "single",
    choices: [
      { value: "under18", label: "Under 18" },
      { value: "18-21", label: "18–21" },
      { value: "22-35", label: "22–35" },
      { value: "36-50", label: "36–50" },
      { value: "over50", label: "Over 50" },
    ],
  },
  {
    id: "S2",
    text: "What do you mainly do?",
    kind: "single",
    choices: [
      { value: "full-time", label: "Full-time work" },
      { value: "part-time", label: "Part-time work" },
      { value: "business", label: "Own business" },
      { value: "student", label: "Student" },
      { value: "other", label: "Other" },
    ],
  },
  {
    id: "S3",
    text: "Which of these have you tracked, in an app or on paper, in the past 2 years?",
    kind: "multi",
    choices: [
      { value: "money", label: "Money" },
      { value: "food", label: "Food" },
      { value: "workouts", label: "Workouts" },
      { value: "habits", label: "Habits" },
      { value: "tasks", label: "Tasks" },
      { value: "none", label: "None" },
    ],
  },
  {
    id: "S4a",
    text: "How many tracking apps have you stopped using, for any reason?",
    kind: "single",
    choices: [
      { value: "0", label: "None" },
      { value: "1", label: "One" },
      { value: "2+", label: "Two or more" },
    ],
  },
  {
    id: "S4b",
    text: "Are you tracking anything right now?",
    kind: "single",
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "S5a",
    text: "Does a coach, trainer, programme or class tell you what to log or check your logs?",
    kind: "single",
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "S5b",
    text: "Do you pay for any tracking, fitness or productivity app or programme now?",
    kind: "single",
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
]

// Shown only when S5b is "yes".
export const S5C = {
  id: "S5c",
  text: "What do you pay for, and about how much a year?",
  placeholder: "e.g. a workout app, a gym class pack",
}

export type ScreenerAnswers = Record<string, string | string[] | undefined>

// The kit's routing table: the first rule that matches wins.
export function route(a: ScreenerAnswers): {
  persona: Persona
  extras: ModuleQ[]
  tag?: string
} {
  const s3 = (a.S3 as string[] | undefined) ?? []
  const stopped = a.S4a
  const trackingNow = a.S4b === "yes"
  const coached = a.S5a === "yes"
  const student = a.S2 === "student"
  if (stopped === "2+") {
    // Overlaps from the kit: a student also gets E7 and E8; a coached
    // lapsed tracker also gets D2 and D5.
    const extras = [
      ...(student
        ? MODULES.E.questions.filter((q) => ["E7", "E8"].includes(q.id))
        : []),
      ...(coached
        ? MODULES.D.questions.filter((q) => ["D2", "D5"].includes(q.id))
        : []),
    ]
    return { persona: "A", extras }
  }
  if (coached) return { persona: "D", extras: [] }
  if (trackingNow) return { persona: "B", extras: [] }
  if (student) return { persona: "E", extras: [] }
  const quitOnce = stopped === "1" && !trackingNow
  return {
    persona: "C",
    extras: [],
    // Someone who stopped none, isn't tracking now, has no coach and isn't a
    // student is not covered by the kit's rule 5; they get module C, tagged
    // "C-unrouted" so the gap shows when answers are coded.
    tag: quitOnce
      ? "C-quit-once"
      : s3.includes("none")
        ? "never"
        : "C-unrouted",
  }
}

export const MODULES: Record<
  Persona,
  { name: string; intro: string; questions: ModuleQ[] }
> = {
  A: {
    name: "You've quit a few trackers",
    intro:
      "Tell us about the trackers you've stopped using. Real stories beat opinions.",
    questions: [
      {
        id: "A1",
        text: "Walk us through the trackers you've used in the last two years, in order. What did each one track?",
        probe:
          "Paper, spreadsheets and notes apps count. Which lasted longest?",
      },
      {
        id: "A2",
        text: "Pick the one you used most. What did a normal day of logging look like: when, where, how long?",
        probe: "e.g. every lunch break, about 5 minutes, at my desk",
      },
      {
        id: "A3",
        text: "Tell us about the last time you stopped logging in it. What was going on that week?",
        probe: "Was it a decision, or did it just fade?",
      },
      {
        id: "A4",
        text: "After you missed a day or a week, what happened when you next opened it, or thought about opening it?",
        probe:
          "What did the app show you? What did you feel? Did you open it again?",
      },
      {
        id: "A5",
        text: "Was there a moment the app itself made it worse? An update, a price change, a notification, a number that felt wrong?",
        probe: "What exactly? When?",
      },
      {
        id: "A6",
        text: "Did you ever stop trusting what it told you: calories, a total, a score? What made you doubt it?",
        probe: "What did you do about it?",
      },
      {
        id: "A7",
        text: "When it was working, what did you actually get out of it? Did it ever change a decision you made?",
        probe: "Did you reach the goal? Did you feel you'd learned enough?",
      },
      {
        id: "A8",
        text: "What do you do now instead, for each thing you used to track?",
        probe: "Nothing is a valid answer. How is that going?",
      },
      {
        id: "A9",
        text: "What do you pay for now, for any tracking, fitness, food or productivity app or programme? Have you cancelled one? Tell us about that.",
        probe:
          "Amount per month or year. Why that one survived. How the cancel went.",
      },
      {
        id: "A10",
        text: "Have you ever gone back to a tracker after quitting? What brought you back, and how long did it last? If you haven't, what happened the last time you thought about it?",
        probe: "What would have had to be different, back then?",
      },
    ],
  },
  B: {
    name: "You track with one app now",
    intro: "Tell us how tracking actually goes for you, day to day.",
    questions: [
      {
        id: "B1",
        text: "What are you tracking now, in which app, and since when?",
        probe: "What made you start?",
      },
      {
        id: "B2",
        text: "Walk us through yesterday's logging. Every time you opened it.",
        probe: "How long did each take? Anything you skipped?",
      },
      {
        id: "B3",
        text: "What else in your life do you keep track of, outside that app? How?",
        probe: "Food, money, workouts, tasks: where does each live?",
      },
      {
        id: "B4",
        text: "Tell us about the last time you missed a day. What happened when you came back?",
        probe: "What did the app show you?",
      },
      {
        id: "B5",
        text: "Has the app ever annoyed you enough that you thought about leaving? What happened?",
        probe: "Update, price, ads, a wrong number?",
      },
      {
        id: "B6",
        text: "Tell us about a time it got something wrong, or you didn't believe a number.",
        probe: "What did you do: fix it, ignore it, stop?",
      },
      {
        id: "B7",
        text: "What did the app help you decide or change in the last month?",
        probe: "A concrete example.",
      },
      {
        id: "B8",
        text: "Have you tried another tracker alongside it or before it? Why did that one lose?",
        probe: "If none: what stops you trying others?",
      },
      {
        id: "B9",
        text: "Do you pay for it? How did you decide, and has the price ever changed on you?",
        probe: "Amount, monthly or yearly, any renewal surprise?",
      },
    ],
  },
  C: {
    name: "You don't track right now",
    intro:
      "No tracker needed to answer. Tell us how you keep on top of things today.",
    questions: [
      {
        id: "C1",
        text: "When did you last want to get a handle on your money, food, training or tasks? What set that off?",
        probe: "What did you do about it?",
      },
      {
        id: "C2",
        text: "How do you keep track of those things today, even roughly?",
        probe: "Notes, memory, bank app, a friend, a coach?",
      },
      {
        id: "C3",
        text: "Have you ever downloaded a tracker, or started a spreadsheet or journal? Tell us what happened.",
        probe: "If you stopped one: how far did you get?",
      },
      {
        id: "C4",
        text: "When you've thought about tracking and didn't, what stopped you?",
        probe: "Time, effort, not wanting to see the numbers?",
      },
      {
        id: "C5",
        text: "Tell us about a time not tracking cost you something: money, a goal, a deadline.",
        probe: "How did you find out? What did you do?",
      },
      {
        id: "C6",
        text: "Has anyone you know used a tracker? What did you see happen to them?",
        probe: "Did it put you off or draw you in?",
      },
      {
        id: "C7",
        text: "Is there anything about tracking that feels uncomfortable? Seeing numbers, being reminded, being judged?",
        probe: "Any example?",
      },
      {
        id: "C8",
        text: "What do you pay for now that helps you organise or improve yourself: apps, gym, programmes, books?",
        probe: "How much a year? Which would you cut first?",
      },
    ],
  },
  D: {
    name: "A coach or programme guides you",
    intro: "Tell us how logging works with your coach or programme.",
    questions: [
      {
        id: "D1",
        text: "Tell us about your coach or programme. How did you start, and what does it cost?",
        probe: "Per month or year.",
      },
      {
        id: "D2",
        text: "What do they ask you to log, and how do you send it to them?",
        probe: "App, spreadsheet, photos, messages?",
      },
      {
        id: "D3",
        text: "Walk us through the last week of logging for them. When did it slip, if it did?",
        probe: "What happened when you sent a gap?",
      },
      {
        id: "D4",
        text: "How does your coach react when you miss? How does that feel?",
        probe: "Did you ever avoid them because of a gap?",
      },
      {
        id: "D5",
        text: "What do you track for yourself that your coach never sees? Where?",
        probe: "Money, tasks, habits?",
      },
      {
        id: "D6",
        text: "Has a number in your log ever been wrong in a way that mattered?",
        probe: "Food database, portion guess, a missed set?",
      },
      {
        id: "D7",
        text: "Have you ever left a coach or programme? What happened to your tracking afterwards?",
        probe: "Did you keep logging alone? For how long?",
      },
      {
        id: "D8",
        text: "What does the coach do for you that an app never has?",
        probe: "A concrete moment.",
      },
      {
        id: "D9",
        text: "Besides the coach, what do you pay for in apps or tools? Anything you've cancelled?",
        probe: "Amounts.",
      },
    ],
  },
  E: {
    name: "You're a student",
    intro: "Tell us how a real week goes, busy weeks included.",
    questions: [
      {
        id: "E1",
        text: "What does a normal week look like: classes, work, training, eating?",
        probe: "What gets dropped when it gets busy?",
      },
      {
        id: "E2",
        text: "What do you keep track of now? Assignments, money, workouts, food? Where?",
        probe: "Uni portal, notes, calendar, nothing?",
      },
      {
        id: "E3",
        text: "Tell us about the last deadline or budget you blew. What happened before it?",
        probe: "When did you notice?",
      },
      {
        id: "E4",
        text: "Have you tried a tracker or planner app? Tell us the story.",
        probe: "How long did it last? Why did it end?",
      },
      {
        id: "E5",
        text: "Tell us about the last exam period or break. What happened to your routines?",
        probe: "Did you pick them back up? How?",
      },
      {
        id: "E6",
        text: "Has an app ever nagged or guilted you? What did you do?",
        probe: "Turned off notifications, deleted it?",
      },
      {
        id: "E7",
        text: "What subscriptions do you pay for, and who pays: you or family? Which did you cancel most recently, and why?",
        probe: "Student discounts used?",
      },
      {
        id: "E8",
        text: "How much time a day, honestly, would you have given logging last week? What happened to that time?",
        probe: "Last week only, not a promise.",
      },
    ],
  },
}

// Kit §2: for C-quit-once, C3 becomes "tell me about the one you stopped".
export const C3_QUIT_ONCE: ModuleQ = {
  id: "C3",
  text: "Tell us about the tracker you stopped using. What happened?",
  probe: "How far did you get? What was going on when it ended?",
}

export const CLOSE = {
  pitch:
    "Unfurl is an app where you tell a companion what happened, in a sentence, a voice note or a photo, and it files your money, food, workouts, habits and tasks for you. It's on TestFlight now.",
  Z1: {
    id: "Z1",
    text: "What's the first thing you'd want to check that it gets right?",
    placeholder: "e.g. that it puts lunch under food, not groceries",
  },
}
