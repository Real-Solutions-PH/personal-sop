import { requireOptionalNativeModule } from "expo"

// The native side of src/prototype/screen-time.ts (iOS only). Absent on
// Android, web, Expo Go, in tests, and in builds prebuilt without
// UNFURL_SCREEN_TIME=1.

export interface ScreenPlanItem {
  groupId: string
  kind: "all" | "custom"
  rungs: number[]
}

export interface UnfurlScreenTimeModule {
  /** "approved" | "denied" | "notDetermined" | "unavailable" */
  authorizationStatus(): Promise<string>
  /** Asks for Family Controls (.individual); answers the status after. */
  requestAuthorization(): Promise<string>
  /** Presents FamilyActivityPicker; true when a non-empty selection is saved. */
  pickApps(groupId: string): Promise<boolean>
  hasSelection(groupId: string): Promise<boolean>
  /** Replaces the monitored schedule with `plan`, one daily window each. */
  startMonitoring(plan: ScreenPlanItem[], dayStartHour: number): Promise<void>
  stopMonitoring(): Promise<void>
  /** The App Group's `screen.events`: one JSON object per line. */
  readEvents(): Promise<string[]>
}

/** Looked up on each call rather than at import, so a build without the
 * module (or a test that installs one) is seen as it is. */
export function screenTimeModule(): UnfurlScreenTimeModule | null {
  return requireOptionalNativeModule<UnfurlScreenTimeModule>("UnfurlScreenTime")
}
