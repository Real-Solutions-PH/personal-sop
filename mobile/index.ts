import "expo-router/entry"
import { registerRunTask } from "./src/prototype/run-tracker"
import { registerSurfacesHeadless } from "./src/surfaces/headless"

registerSurfacesHeadless()
registerRunTask()
