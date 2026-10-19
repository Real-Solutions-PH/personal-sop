// Fitness · nutrition (live): macro targets, meals and meal items, the
// estimate review flow, and the macros left for the day.
//
// Inventory (screen → action → test):
// | Screen                              | Action                                         | Test |
// |-------------------------------------|------------------------------------------------|------|
// | Targets (/fitness/nutrition/targets)| Set calories + protein, "Auto-split carbs/fat", Save  | N1   |
// | Targets                             | "Help me pick" → Suggest → Use → Save (same day: one row) | N1   |
// | Eat (/fitness?tab=eat)              | Macros left (kcal + protein) = target − eaten  | N1   |
// | Log meal (/fitness/nutrition/new)   | Food picker add, custom item, qty ±, remove item, label, Save | N1 |
// | Log meal                            | Describe it → Estimate macros                  | N2   |
// | Review estimate (meal detail)       | Follow-up answer, Re-estimate hint, Confirm    | N2   |
// | Meal detail (confirmed)             | Edit: qty, edit macros, remove item, add food, label, time | N2 |
// | Meal detail                         | Duplicate to today                             | N2   |
// | Meal detail                         | Delete, then Undo                              | N2   |
// | Eat                                 | Previous / next day                            | N2   |
// | Nutrition history                   | Day row opens that day                         | N2   |
// | Eat                                 | Photo meal estimate — NOT COVERABLE ON WEB: needs the camera / a native image picker, and the live mapper does not upload photos (REST upload path only). Covered by its manual equivalent, "Describe it", in N2. | — |
// | Eat                                 | Chat / Voice capture buttons open the capture module (capture module's specs) | — |
import { api, rows, signIn } from "./fitness.helpers"
import type { LiveUser } from "./support"

// The app's business day starts at 04:00 (DAY_START_HOUR in
// shared/prototype/lib/day.ts): 00:30 still belongs to yesterday.
const today = () => {
  const d = new Date(Date.now() - 4 * 3600000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const MEAL_ITEMS =
  "select id, name, qty, unit, kcal, protein, carbs, fat, assumption from meal_item where meal_id = $1 and deleted_at is null order by position, name"

function seedLibrary(user: LiveUser) {
  cy.liveApi(user, "GET", "/fitness/overview")
}

function setStepper(label: string, value: number) {
  cy.findByRole("textbox", { name: label }).clear().type(String(value)).blur()
}

describe("fitness · nutrition (live)", { defaultCommandTimeout: 60000 }, () => {
  it("N1: targets, manual meal, macros left", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      signIn(user)
      cy.visit("/fitness?tab=eat")
      cy.findByText("No targets set — showing totals eaten.", {
        timeout: 90000,
      }).should("exist")
      cy.findByRole("button", { name: "Set targets" }).click()
      cy.location("pathname").should("eq", "/fitness/nutrition/targets")

      setStepper("Calories", 2000)
      // 180 g protein with the default 210 g carbs / 70 g fat overshoots
      // 2,000 kcal by more than 5 %, so the auto-split is offered.
      setStepper("Protein", 180)
      cy.findByText("Auto-split carbs/fat").click()
      cy.findByRole("textbox", { name: "Fat" }).should("have.value", "60")
      cy.findByRole("textbox", { name: "Carbs" }).should("have.value", "185")
      cy.findByRole("button", { name: "Save · effective today" }).click()
      cy.location("search").should("eq", "?tab=eat")
      const TARGET =
        "select id, effective_from::text as day, kcal, protein, carbs, fat from macro_target where owner_id = $1 and deleted_at is null"
      rows(`${TARGET} and kcal = 2000`, [user.id]).then(([t]) => {
        expect(t).to.include({
          day: today(),
          protein: 180,
          carbs: 185,
          fat: 60,
        })
      })

      // Suggest → Use → Save on the same day replaces today's target.
      cy.findByRole("button", { name: "Targets" }).click()
      cy.findByRole("button", { name: "Suggest" }).click()
      cy.findByText("Use").click()
      cy.findByRole("textbox", { name: "Calories" }).should(
        "not.have.value",
        "2000",
      )
      cy.findByRole("textbox", { name: "Calories" })
        .invoke("val")
        .then((kcal) => {
          cy.findByRole("button", { name: "Save · effective today" }).click()
          rows(`${TARGET} and kcal = $2`, [user.id, Number(kcal)])
          cy.wait(3000)
          cy.task<unknown[]>("sql", {
            text: `${TARGET} and effective_from = $2::date`,
            values: [user.id, today()],
          }).then((found) =>
            expect(found, "one target per day").to.have.length(1),
          )
          api<{ current: { kcal: number } | null }>(
            user,
            "/fitness/targets",
            (b) => b.current?.kcal === Number(kcal),
          )
        })

      // Manual meal: picker items, a custom item, qty, remove, label.
      cy.findByText("Manual").click()
      cy.location("pathname").should("eq", "/fitness/nutrition/new")
      cy.findByRole("textbox", { name: "Add food" }).type("rice")
      cy.findByText("Steamed rice").click()
      cy.findByRole("textbox", { name: "Add food" }).type("egg")
      cy.findByText("Fried egg").click()
      cy.findByRole("textbox", { name: "Custom item name" }).type("E2E shake")
      cy.findByRole("textbox", { name: "kcal" }).type("200")
      cy.findByRole("textbox", { name: "protein" }).type("30")
      cy.findByRole("textbox", { name: "carbs" }).type("10")
      cy.findByRole("textbox", { name: "fat" }).type("4")
      cy.findByRole("button", { name: "Add custom item" }).click()
      cy.findAllByRole("button", { name: "More" }).first().click()
      cy.findByText("1.5 cup").should("exist")
      cy.findAllByRole("button", { name: "Remove item" }).eq(1).click()
      cy.findByText("Fried egg").should("not.exist")
      cy.findByText("dinner").click()
      cy.findByRole("button", { name: /^Save meal · \d+ kcal$/ }).click()
      cy.location("search").should("contain", "tab=eat")

      rows(
        "select id, label, status, source from meal where owner_id = $1 and deleted_at is null",
        [user.id],
      ).then(([meal]) => {
        expect(meal).to.include({
          label: "dinner",
          status: "confirmed",
          source: "manual",
        })
        rows(MEAL_ITEMS, [meal.id], 2).then((items) => {
          const byName = Object.fromEntries(items.map((i) => [i.name, i]))
          expect(Object.keys(byName).sort()).to.deep.eq([
            "E2E shake",
            "Steamed rice",
          ])
          expect(byName["Steamed rice"]).to.include({ qty: 1.5, unit: "cup" })
          expect(byName["E2E shake"]).to.include({
            kcal: 200,
            protein: 30,
            carbs: 10,
            fat: 4,
          })
        })
      })

      // Macros left: the screen, the API and target − Postgres totals agree.
      api<{
        left: { kcal: number; protein: number } | null
        meals: unknown[]
      }>(
        user,
        `/fitness/nutrition/day?day=${today()}`,
        (b) => b.meals.length === 1 && b.left !== null,
      ).then((day) => {
        cy.task<{ kcal: number; protein: number }[]>("sql", {
          text: `select t.kcal - sum(i.kcal) kcal, t.protein - sum(i.protein) protein
            from meal_item i join meal m on m.id = i.meal_id
            join macro_target t on t.owner_id = m.owner_id and t.deleted_at is null
            where m.owner_id = $1 and m.deleted_at is null and i.deleted_at is null
            group by t.kcal, t.protein`,
          values: [user.id],
        }).then(([db]) => {
          expect(Math.round(day.left!.kcal)).to.eq(Math.round(db.kcal))
          cy.findByText(/^kcal (left|over)$/)
            .prev()
            .should("have.text", String(Math.abs(Math.round(db.kcal))))
          cy.findByText(`${Math.max(0, Math.round(db.protein))}g left`).should(
            "exist",
          )
        })
      })
    })
  })

  it("N2: estimate review, edit items, duplicate, delete + undo, days, history", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      signIn(user)
      cy.visit(`/fitness/nutrition/new?day=${today()}`)
      cy.findByRole("textbox", { name: "Describe your meal" }).type(
        "lunch: rice, chicken adobo",
      )
      cy.findByRole("button", { name: "Estimate macros" }).click()
      cy.location("pathname").should("match", /^\/fitness\/nutrition\/meals\//)
      cy.findByText("Review estimate").should("exist")
      cy.location("pathname").then((path) => {
        const mid = path.split("/").pop() as string
        rows(
          "select status, source, raw_input from meal where id = $1 and status = 'estimated'",
          [mid],
        )
        rows(MEAL_ITEMS, [mid], 2)

        // Follow-up: "How much rice?" → 2 cups.
        cy.findByText("How much rice?").should("exist")
        cy.findByRole("button", { name: "2 cups" }).click()
        rows(
          `${MEAL_ITEMS.replace("order by", "and qty = 2 and assumption = '2 cups, you said' order by")}`,
          [mid],
        )

        // Re-estimate with a hint replaces the items.
        cy.findByRole("textbox", { name: "Re-estimate hint" }).type(
          "chicken adobo, fried egg",
        )
        cy.findByRole("button", { name: "Re-estimate" }).click()
        rows(
          `${MEAL_ITEMS.replace("order by", "and name = 'Fried egg' order by")}`,
          [mid],
        )

        cy.findByRole("button", { name: /^Confirm · \d+ kcal$/ }).click()
        cy.location("search").should("contain", "tab=eat")
        rows("select 1 from meal where id = $1 and status = 'confirmed'", [mid])

        // Edit the confirmed meal.
        cy.visit(`/fitness/nutrition/meals/${mid}`)
        cy.findByText("Edit", { timeout: 90000 }).click()
        rows(MEAL_ITEMS, [mid]).then((before) => {
          const first = before[0] as { id: string; qty: number; name: string }
          cy.findAllByRole("button", { name: "More" }).first().click()
          rows("select 1 from meal_item where id = $1 and qty > $2", [
            first.id,
            first.qty,
          ])
          cy.findAllByText("Edit macros").first().click()
          cy.findByRole("textbox", { name: "kcal" }).clear().type("333")
          rows("select 1 from meal_item where id = $1 and kcal = 333", [
            first.id,
          ])
          cy.findByText("Done").click()
          cy.findAllByRole("button", { name: "Remove item" }).first().click()
          rows(
            "select 1 from meal_item where id = $1 and deleted_at is not null",
            [first.id],
          )
        })
        cy.findByRole("textbox", { name: "Add food" }).type("banana")
        cy.findByText("Banana").click()
        rows(
          `${MEAL_ITEMS.replace("order by", "and name like 'Banana%' order by")}`,
          [mid],
        )
        cy.findByText("snack").click()
        rows("select 1 from meal where id = $1 and label = 'snack'", [mid])
        cy.findByRole("textbox", { name: "Time eaten" }).clear().type("07:30")
        rows("select eaten_at from meal where id = $1", [mid]).then(([m]) =>
          expect(
            new Date(m.eaten_at as string).toTimeString().slice(0, 5),
          ).to.eq("07:30"),
        )
        cy.findByText("Done").click()

        // Duplicate to today.
        cy.findByRole("button", { name: "Duplicate to today" }).click()
        rows(
          "select id from meal where owner_id = $1 and deleted_at is null and id <> $2",
          [user.id, mid],
        ).then(([copy]) =>
          cy
            .task<unknown[]>("sql", { text: MEAL_ITEMS, values: [mid] })
            .then((orig) => rows(MEAL_ITEMS, [copy.id], orig.length)),
        )

        // Delete, then Undo.
        cy.findByRole("button", { name: "Delete" }).click()
        cy.location("search").should("contain", "tab=eat")
        rows("select 1 from meal where id = $1 and deleted_at is not null", [
          mid,
        ])
        cy.findByText("Undo").click()
        rows("select 1 from meal where id = $1 and deleted_at is null", [mid])
        api<{ meals: { id: string }[] }>(
          user,
          `/fitness/nutrition/day?day=${today()}`,
          (b) => b.meals.some((m) => m.id === mid) && b.meals.length === 2,
        )

        // Day navigation and history.
        cy.findByRole("button", { name: "Previous day" }).click()
        cy.findByText("Nothing logged — snap your plate").should("exist")
        cy.findByRole("button", { name: "Next day" }).click()
        cy.findByText("Nothing logged — snap your plate").should("not.exist")
        cy.findByRole("button", { name: "History" }).click()
        cy.location("pathname").should("eq", "/fitness/nutrition/history")
        cy.findByText("No meals logged in this range").should("not.exist")
      })
    })
  })
})
