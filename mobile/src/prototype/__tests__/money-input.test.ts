import { groupPesos, pesoDraft } from "../peso-input"

test("the minimum balance keeps its decimal point", () => {
  // Stripping every non-digit read ₱2,500.75 as ₱250,075.
  expect(Number(pesoDraft("2500.75"))).toBe(2500.75)
  expect(Number(pesoDraft("2,500.75"))).toBe(2500.75)
  expect(pesoDraft("2500.")).toBe("2500.")
  expect(pesoDraft("1.2.3")).toBe("1.23")
  expect(pesoDraft("10.999")).toBe("10.99")
  expect(pesoDraft("abc")).toBe("")
})

test("the field shows thousands separators without losing the decimals", () => {
  expect(groupPesos("2500.75")).toBe("2,500.75")
  expect(groupPesos("2500.")).toBe("2,500.")
  expect(groupPesos("1234567")).toBe("1,234,567")
  expect(groupPesos("")).toBe("")
  // Re-typing over the grouped value round-trips.
  expect(Number(pesoDraft(groupPesos("2500.75")))).toBe(2500.75)
})
