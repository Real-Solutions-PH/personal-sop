package expo.modules.unfurlsurfaces

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The JS side of ADR-0020 on Android: writes the widget snapshot, shows the
// ongoing notification for the running routine/workout/timer, and hands the
// app the taps queued by SurfaceActionReceiver.
class UnfurlSurfacesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("UnfurlSurfaces")
    Events("onAction")

    // Only while the app's UI listens (src/surfaces/bridge.tsx); a headless
    // run leaves it unset so the receiver starts the drain task instead.
    OnStartObserving {
      listener = { sendEvent("onAction", mapOf<String, Any>()) }
    }
    OnStopObserving {
      listener = null
    }
    OnDestroy {
      listener = null
    }

    Function("setSnapshot") { json: String ->
      val ctx = appContext.reactContext ?: return@Function
      SurfaceStore.saveSnapshot(ctx, json)
      UnfurlWidgets.updateAll(ctx)
    }
    Function("setLive") { json: String? ->
      val ctx = appContext.reactContext ?: return@Function
      LiveNotification.show(ctx, json)
    }
    Function("drainActions") {
      val ctx = appContext.reactContext ?: return@Function "[]"
      SurfaceStore.drain(ctx)
    }
  }

  companion object {
    /** Set while the app's JS runtime is up; a tap then reaches it directly. */
    @Volatile
    var listener: (() -> Unit)? = null
  }
}
