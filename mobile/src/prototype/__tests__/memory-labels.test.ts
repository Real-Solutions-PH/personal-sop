import {
  KIND_LABEL,
  kindLabel,
  MEMORY_KINDS,
  memoryCount,
  parseTags,
  sourceLabel,
} from "../companion/memory-labels"

test("every kind has its plain-language label", () => {
  expect(MEMORY_KINDS.map((k) => KIND_LABEL[k])).toEqual([
    "How to answer",
    "About you",
    "Likes",
    "Facts",
    "Goals",
    "People",
    "Health",
    "Routines",
    "Events",
  ])
  expect(kindLabel(undefined)).toBe("Facts")
  expect(kindLabel("dream")).toBe("dream")
})

test("where a memory came from", () => {
  expect(sourceLabel("said", "Fern")).toBe("you said")
  expect(sourceLabel("app", "Fern")).toBe("you said")
  expect(sourceLabel(undefined, "Fern")).toBe("you said")
  expect(sourceLabel("inferred", "Nova")).toBe("Nova noticed")
  expect(sourceLabel("import", "Fern")).toBe("import")
})

test("tags follow the server's rule", () => {
  expect(parseTags(" Dog, morning ,dog,, ")).toEqual(["dog", "morning"])
  expect(parseTags("x".repeat(40))).toEqual(["x".repeat(30)])
  expect(parseTags("a,b,c,d,e,f,g,h,i,j")).toHaveLength(8)
})

test("memory counts are grouped", () => {
  expect(memoryCount(0)).toBe("No memories yet")
  expect(memoryCount(1)).toBe("1 memory")
  expect(memoryCount(1204)).toBe("1,204 memories")
})
