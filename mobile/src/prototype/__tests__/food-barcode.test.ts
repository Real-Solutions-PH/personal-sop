// Looking a scanned barcode up in Open Food Facts and turning the product
// into a meal item for the grams eaten.
import { itemFor, lookupBarcode, type Product } from "../food-barcode"

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })

const chips = {
  status: 1,
  product: {
    product_name: "Potato chips",
    brands: "Crunchy Co, Other",
    serving_quantity: 30,
    nutriments: {
      "energy-kcal_100g": 536,
      proteins_100g: 6.6,
      carbohydrates_100g: 53,
      fat_100g: 34,
      fiber_100g: 4.5,
      "saturated-fat_100g": 3.1,
      sugars_100g: 0.4,
      sodium_100g: 0.52,
    },
  },
}

test("a found product: name, brand, serving and per-100 g nutrition", async () => {
  const fetcher = jest.fn((_url: string, _init?: unknown) => json(200, chips))
  expect(await lookupBarcode("4800016644443", fetcher)).toEqual({
    code: "4800016644443",
    name: "Potato chips",
    brand: "Crunchy Co",
    servingG: 30,
    per100: {
      kcal: 536,
      protein: 6.6,
      carbs: 53,
      fat: 34,
      fiber: 4.5,
      satFat: 3.1,
      sugar: 0.4,
      sodium: 520,
    },
  })
  const [url, init] = fetcher.mock.calls[0] ?? []
  expect(url).toBe(
    "https://world.openfoodfacts.org/api/v2/product/4800016644443.json?fields=product_name,brands,serving_quantity,nutriments",
  )
  expect(init).toMatchObject({
    headers: { "User-Agent": expect.stringMatching(/^Unfurl\//) },
  })
})

test("not in the database: null", async () => {
  expect(
    await lookupBarcode("4800016644443", () => json(404, { status: 0 })),
  ).toBeNull()
  // Found but with no calories: not usable either.
  expect(
    await lookupBarcode("4800016644443", () =>
      json(200, {
        status: 1,
        product: { product_name: "Mystery", nutriments: {} },
      }),
    ),
  ).toBeNull()
})

test("offline or a server error: 'error', so the screen can say try again", async () => {
  expect(
    await lookupBarcode("4800016644443", () =>
      Promise.reject(new Error("offline")),
    ),
  ).toBe("error")
  expect(await lookupBarcode("4800016644443", () => json(503, {}))).toBe(
    "error",
  )
})

test("only digits 8 to 14 long are looked up", async () => {
  const fetcher = jest.fn(() => json(200, chips))
  expect(await lookupBarcode("../../admin", fetcher)).toBeNull()
  expect(await lookupBarcode("123", fetcher)).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})

test("a meal item for the grams eaten, rounded like the rest of the app", () => {
  const p: Product = {
    code: "1",
    name: "Potato chips",
    brand: "Crunchy Co",
    servingG: 30,
    per100: { kcal: 536, protein: 6.6, carbs: 53, fat: 34, sodium: 520 },
  }
  expect(itemFor(p, 30)).toEqual({
    name: "Potato chips (Crunchy Co)",
    qty: 30,
    unit: "g",
    kcal: 161,
    protein: 2,
    carbs: 16,
    fat: 10,
    sodium: 156,
    assumption: "Open Food Facts, per 100 g label",
  })
})
