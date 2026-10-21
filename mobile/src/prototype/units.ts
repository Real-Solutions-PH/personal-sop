export function displayMass(kg: number, unit: "kg" | "lb") {
  return Math.round(kg * (unit === "lb" ? 2.2046226218 : 1) * 10) / 10
}
export function kilograms(value: number, unit: "kg" | "lb") {
  return unit === "lb" ? value / 2.2046226218 : value
}
