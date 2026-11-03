// The iPhone's own step counter (Core Motion) for a session's window. It
// answers while the phone is locked, when Apple Health's store cannot be
// read, so the lock screen's step count keeps moving with the distance.
// Null when the device has no counter, motion access was refused, or this
// build lacks the module.

type Sensors = typeof import("expo-sensors")

function load(): Sensors | null {
  try {
    return require("expo-sensors") as Sensors
  } catch {
    return null
  }
}

export async function readSteps(
  start: Date,
  end: Date,
): Promise<number | null> {
  const P = load()?.Pedometer
  if (!P) return null
  try {
    if (!(await P.isAvailableAsync())) return null
    const r = await P.getStepCountAsync(start, end)
    return Math.max(0, Math.round(r.steps))
  } catch {
    return null
  }
}
