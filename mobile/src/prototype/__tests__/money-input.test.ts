// The helpers live beside the field, whose module loads the UI kit.
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
}))
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => () => null)
jest.mock("sonner-native", () => ({ toast: jest.fn() }))

const { amountDraft, groupAmount } =
  require("../money-input") as typeof import("../money-input")

test("the minimum balance keeps its decimal point", () => {
  // Stripping every non-digit read 2,500.75 as 250,075.
  expect(Number(amountDraft("2500.75"))).toBe(2500.75)
  expect(Number(amountDraft("2,500.75"))).toBe(2500.75)
  expect(amountDraft("2500.")).toBe("2500.")
  expect(amountDraft("1.2.3")).toBe("1.23")
  expect(amountDraft("10.999")).toBe("10.99")
  expect(amountDraft("abc")).toBe("")
})

test("a zero-decimal currency takes no decimal point", () => {
  expect(amountDraft("2500.75", 0)).toBe("2500")
  expect(amountDraft("1,000", 0)).toBe("1000")
})

test("the field shows thousands separators without losing the decimals", () => {
  expect(groupAmount("2500.75")).toBe("2,500.75")
  expect(groupAmount("2500.")).toBe("2,500.")
  expect(groupAmount("1234567")).toBe("1,234,567")
  expect(groupAmount("")).toBe("")
  // Re-typing over the grouped value round-trips.
  expect(Number(amountDraft(groupAmount("2500.75")))).toBe(2500.75)
})
