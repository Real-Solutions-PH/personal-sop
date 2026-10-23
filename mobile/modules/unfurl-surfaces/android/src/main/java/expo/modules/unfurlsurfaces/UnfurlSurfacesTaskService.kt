package expo.modules.unfurlsurfaces

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Runs the JS task registered as "UnfurlSurfacesDrain"
 * (src/surfaces/headless.ts), which applies queued taps to the stores. */
class UnfurlSurfacesTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig("UnfurlSurfacesDrain", Arguments.createMap(), 15_000, true)
}
