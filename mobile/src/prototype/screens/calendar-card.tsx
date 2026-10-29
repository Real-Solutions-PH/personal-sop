// Today's events from the phone's calendars, on Today. Before access is
// asked: a one-line offer to allow it, which can be dismissed (that turns
// Calendar off in Settings). Denied or unavailable: nothing.
import { X } from "lucide-react-native"
import { useCallback, useEffect, useState } from "react"
import { AppState, View } from "react-native"
import {
  type CalendarStatus,
  calendarStatus,
  connectCalendar,
  type DayEvent,
  readEvents,
  upcoming,
} from "../calendar"
import { setShown } from "../extras"
import { Copy, Frame, IconTap, Line } from "../native-kit"
import { useTheme } from "../theme"
import { Button } from "../ui"

const SHOWN = 5
const time = (d: Date) =>
  d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })

export function CalendarCard() {
  const t = useTheme(),
    [status, setStatus] = useState<CalendarStatus>(),
    [events, setEvents] = useState<DayEvent[] | null>()
  const load = useCallback(async () => {
    const s = await calendarStatus()
    setStatus(s)
    setEvents(s === "granted" ? await readEvents(new Date()) : null)
  }, [])
  useEffect(() => {
    void load()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load()
    })
    return () => sub.remove()
  }, [load])
  if (status === "undetermined")
    return (
      <Frame style={{ padding: 12, marginTop: 16 }}>
        <Line style={{ gap: 8 }}>
          <Copy size={14} style={{ flex: 1 }}>
            See today's events here
          </Copy>
          <Button
            small
            onPress={async () => {
              await connectCalendar()
              await load()
            }}
          >
            Allow calendar
          </Button>
          <IconTap
            icon={X}
            label="Hide calendar on Today"
            onPress={() => setShown("calendar", false)}
          />
        </Line>
      </Frame>
    )
  if (status !== "granted" || !events) return null
  const ahead = upcoming(events, new Date())
  return (
    <Frame style={{ padding: 16, marginTop: 16, gap: 8 }}>
      <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
        CALENDAR
      </Copy>
      {ahead.length ? (
        ahead.slice(0, SHOWN).map((e) => (
          <Line key={e.id} style={{ gap: 12 }}>
            <View style={{ width: 64 }}>
              <Copy size={13} muted>
                {e.allDay ? "All day" : time(e.start)}
              </Copy>
            </View>
            <Copy size={14} style={{ flex: 1 }} lines={1}>
              {e.title}
            </Copy>
          </Line>
        ))
      ) : (
        <Copy size={14} muted>
          Nothing else on your calendar today.
        </Copy>
      )}
      {ahead.length > SHOWN && (
        <Copy size={12} style={{ color: t.muted }}>
          {`+${ahead.length - SHOWN} more`}
        </Copy>
      )}
    </Frame>
  )
}
