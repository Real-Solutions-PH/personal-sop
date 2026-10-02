import { configureNotifications } from "../../../../shared/prototype/lib/platform"
import { toast } from "./toast"

configureNotifications(toast)

export * from "../../../../shared/prototype/capture/engine"
