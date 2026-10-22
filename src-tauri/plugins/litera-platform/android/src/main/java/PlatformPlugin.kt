package com.maplume.litera.platform

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.KeyEvent
import android.view.Window
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors

@InvokeArg
class FlagArgs {
  var enabled: Boolean = false
}

/**
 * The platform event bridge the mobile shell talks to. Events: `back`,
 * `backProgress` (the predictive Back gesture before it commits), `volumeKey`, `lifecycle`, `incomingBooks`, `insets`. Commands: the document
 * pickers (books and fonts), the current insets, immersive mode, the system bar icon colour,
 * keep-screen-on, volume-key interception, network type and leaving the app.
 *
 * Picked and shared EPUBs are copied into `cacheDir/incoming-books/` and
 * handed to the WebView as `{ name, path }`; the Rust import command reads
 * and deletes them. Picked fonts take the same route through
 * `cacheDir/incoming-fonts/`. Bytes never cross the JSON bridge.
 */
@TauriPlugin
class PlatformPlugin(private val activity: Activity) : Plugin(activity) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val incomingLock = Any()
  // Books that arrived before the WebView listened (a cold start "Open with").
  private val pendingIncoming = mutableListOf<JSObject>()
  @Volatile private var volumeKeyPaging = false
  private val insetsLock = Any()
  private var lastInsets: JSObject? = null
  private var webView: WebView? = null

  private val backCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      if (hasListener(BACK_EVENT)) {
        trigger(BACK_EVENT, JSObject())
        return
      }
      // No shell listening (still loading): let the system handle it.
      isEnabled = false
      (activity as AppCompatActivity).onBackPressedDispatcher.onBackPressed()
      isEnabled = true
    }

    // The predictive Back gesture (Android 14+): the shell previews what
    // Back will close while the finger moves; `back` still commits it.
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
      triggerBackProgress("start", backEvent)
    }

    override fun handleOnBackProgressed(backEvent: BackEventCompat) {
      triggerBackProgress("progress", backEvent)
    }

    override fun handleOnBackCancelled() {
      if (hasListener(BACK_PROGRESS_EVENT)) {
        trigger(BACK_PROGRESS_EVENT, JSObject().apply { put("phase", "cancel") })
      }
    }
  }

  private fun triggerBackProgress(phase: String, backEvent: BackEventCompat) {
    if (!hasListener(BACK_PROGRESS_EVENT)) return
    trigger(BACK_PROGRESS_EVENT, JSObject().apply {
      put("phase", phase)
      put("progress", backEvent.progress.toDouble())
      put("edge", if (backEvent.swipeEdge == BackEventCompat.EDGE_RIGHT) "right" else "left")
    })
  }

  override fun load(webView: WebView) {
    this.webView = webView
    // Registered after Tauri's own callback, so this one runs first.
    (activity as AppCompatActivity).onBackPressedDispatcher.addCallback(activity, backCallback)
    interceptVolumeKeys(activity.window)
    publishInsets(webView)
    handleIntent(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    handleIntent(intent)
  }

  // Stopped, not paused: a pause also comes with multi-window focus changes
  // and dialogs, which aren't the app leaving the screen.
  override fun onRestart(activity: AppCompatActivity) {
    trigger(LIFECYCLE_EVENT, JSObject().apply { put("state", "foreground") })
  }

  override fun onStop(activity: AppCompatActivity) {
    trigger(LIFECYCLE_EVENT, JSObject().apply { put("state", "background") })
  }

  // --- Volume keys ---------------------------------------------------------

  private fun interceptVolumeKeys(window: Window) {
    val original = window.callback ?: return
    window.callback = object : Window.Callback by original {
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (handleVolumeKey(event)) return true
        return original.dispatchKeyEvent(event)
      }
    }
  }

  /** Swallows volume keys only while the reader asked for them. */
  private fun handleVolumeKey(event: KeyEvent): Boolean {
    if (!volumeKeyPaging) return false
    val direction = when (event.keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> "up"
      KeyEvent.KEYCODE_VOLUME_DOWN -> "down"
      else -> return false
    }
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      trigger(VOLUME_KEY_EVENT, JSObject().apply { put("direction", direction) })
    }
    return true
  }

  // --- Insets --------------------------------------------------------------

  /**
   * Edge-to-edge WebViews don't resize for system bars or the keyboard, so
   * the visible insets (in CSS px) go to the WebView as the `insets` event
   * and the `getInsets` command. Pushing a script into the page instead
   * loses the values whenever the page (re)loads after the last change,
   * which on a cold start is always. Hidden bars (immersive mode) report
   * zero; `cutout*` stays put either way so the reader can avoid a notch.
   */
  private fun publishInsets(webView: WebView) {
    var animatingIme = false
    fun dispatch(insets: WindowInsetsCompat) {
      val density = webView.resources.displayMetrics.density
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val payload = JSObject().apply {
        put("top", bars.top / density)
        put("bottom", bars.bottom / density)
        put("imeBottom", ime.bottom / density)
        put("left", bars.left / density)
        put("right", bars.right / density)
        put("cutoutTop", cutout.top / density)
        put("cutoutBottom", cutout.bottom / density)
      }
      synchronized(insetsLock) { lastInsets = payload }
      trigger(INSETS_EVENT, payload)
    }
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      // During an IME animation this is already the final inset. Publishing
      // it now would jump to the end before onProgress delivers the frames.
      if (!animatingIme) dispatch(insets)
      ViewCompat.onApplyWindowInsets(view, insets)
    }
    ViewCompat.setWindowInsetsAnimationCallback(webView, object : WindowInsetsAnimationCompat.Callback(
      WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
    ) {
      override fun onPrepare(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) animatingIme = true
      }

      override fun onProgress(
        insets: WindowInsetsCompat,
        runningAnimations: MutableList<WindowInsetsAnimationCompat>
      ): WindowInsetsCompat {
        if (animatingIme) dispatch(insets)
        return insets
      }

      override fun onEnd(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
        animatingIme = false
        ViewCompat.getRootWindowInsets(webView)?.let { dispatch(it) }
      }
    })
    ViewCompat.requestApplyInsets(webView)
  }

  @Command
  fun getInsets(invoke: Invoke) {
    val insets = synchronized(insetsLock) { lastInsets }
    if (insets != null) {
      invoke.resolve(insets)
      return
    }
    // Not laid out yet: ask for a pass; the event follows.
    activity.runOnUiThread { webView?.let { ViewCompat.requestApplyInsets(it) } }
    invoke.resolve(JSObject())
  }

  // --- Incoming books ------------------------------------------------------

  private fun handleIntent(intent: Intent?) {
    if (intent == null || intent.getBooleanExtra(HANDLED_EXTRA, false)) return
    val uris = incomingUris(intent)
    if (uris.isEmpty()) return
    // Never import the same intent twice (activity recreation re-delivers it).
    intent.putExtra(HANDLED_EXTRA, true)
    io.execute { deliverIncoming(copyAllToCache(uris)) }
  }

  @Suppress("DEPRECATION")
  private fun incomingUris(intent: Intent): List<Uri> {
    return when (intent.action) {
      Intent.ACTION_VIEW -> listOfNotNull(intent.data)
      Intent.ACTION_SEND -> listOfNotNull(
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)
      )
      Intent.ACTION_SEND_MULTIPLE -> (
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
      )?.toList() ?: emptyList()
      else -> emptyList()
    }
  }

  private fun deliverIncoming(payload: JSObject) {
    synchronized(incomingLock) {
      if (hasListener(INCOMING_EVENT)) {
        trigger(INCOMING_EVENT, payload)
      } else {
        pendingIncoming.add(payload)
      }
    }
  }

  @Command
  fun takePendingIncomingBooks(invoke: Invoke) {
    val books = JSArray()
    synchronized(incomingLock) {
      for (payload in pendingIncoming) {
        val items = payload.getJSONArray("books")
        for (i in 0 until items.length()) books.put(items.get(i))
      }
      pendingIncoming.clear()
    }
    invoke.resolve(JSObject().apply { put("books", books) })
  }

  /** `{ books: [...] }`, one entry per URI. Runs on the IO thread. */
  private fun copyAllToCache(uris: List<Uri>): JSObject {
    val books = JSArray()
    for (uri in uris) books.put(copyToCache(uri, INCOMING_DIR, "book.epub"))
    return JSObject().apply { put("books", books) }
  }

  /** `{ name, path }` on success, `{ name, error }` when the file can't be read. */
  private fun copyToCache(uri: Uri, dirName: String, fallbackName: String): JSObject {
    val name = displayName(uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: fallbackName
    return try {
      val dir = File(activity.cacheDir, dirName)
      if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Cannot create $dir")
      val file = File(dir, UUID.randomUUID().toString() + "." + fallbackName.substringAfterLast('.'))
      val input = activity.contentResolver.openInputStream(uri)
        ?: throw IOException("Cannot open $uri")
      input.use { stream -> file.outputStream().use { stream.copyTo(it) } }
      JSObject().apply {
        put("name", name)
        put("path", file.absolutePath)
      }
    } catch (ex: Exception) {
      Logger.error("Failed to read incoming file: ${ex.message}")
      JSObject().apply {
        put("name", name)
        put("error", ex.message ?: "Failed to read file")
      }
    }
  }

  private fun displayName(uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    return try {
      activity.contentResolver
        .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    } catch (ex: Exception) {
      null
    }
  }

  // --- Picker --------------------------------------------------------------

  @Command
  fun pickBooks(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        // Some providers label EPUBs as generic binaries; the import checks
        // the file itself.
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(EPUB_MIME, "application/octet-stream"))
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      startActivityForResult(invoke, intent, "pickBooksResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Failed to open the file picker")
    }
  }

  @ActivityCallback
  fun pickBooksResult(invoke: Invoke, result: ActivityResult) {
    val uris = pickedUris(result)
    io.execute { invoke.resolve(copyAllToCache(uris)) }
  }

  @Command
  fun pickFonts(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        // Font MIME types vary by provider; the import checks the file itself.
        putExtra(Intent.EXTRA_MIME_TYPES, FONT_MIMES)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      startActivityForResult(invoke, intent, "pickFontsResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Failed to open the file picker")
    }
  }

  @ActivityCallback
  fun pickFontsResult(invoke: Invoke, result: ActivityResult) {
    val uris = pickedUris(result)
    io.execute {
      val fonts = JSArray()
      for (uri in uris) fonts.put(copyToCache(uri, INCOMING_FONTS_DIR, "font.ttf"))
      invoke.resolve(JSObject().apply { put("fonts", fonts) })
    }
  }

  /** Cancelling the picker is not an error: it picks nothing. */
  private fun pickedUris(result: ActivityResult): List<Uri> {
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) return emptyList()
    val uris = mutableListOf<Uri>()
    val clip = data.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
    } else {
      data.data?.let { uris.add(it) }
    }
    return uris
  }

  // --- Window --------------------------------------------------------------

  @Command
  fun setImmersive(invoke: Invoke) {
    val args = invoke.parseArgs(FlagArgs::class.java)
    activity.runOnUiThread {
      val window = activity.window
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      if (args.enabled) {
        controller.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
      }
      invoke.resolve()
    }
  }

  /** Dark status/navigation bar icons on a light page, light ones on a dark page. */
  @Command
  fun setSystemBarsLight(invoke: Invoke) {
    val args = invoke.parseArgs(FlagArgs::class.java)
    activity.runOnUiThread {
      val window = activity.window
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = args.enabled
      controller.isAppearanceLightNavigationBars = args.enabled
      invoke.resolve()
    }
  }

  @Command
  fun setKeepScreenOn(invoke: Invoke) {
    val args = invoke.parseArgs(FlagArgs::class.java)
    activity.runOnUiThread {
      if (args.enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
      invoke.resolve()
    }
  }

  @Command
  fun setVolumeKeyPaging(invoke: Invoke) {
    val args = invoke.parseArgs(FlagArgs::class.java)
    volumeKeyPaging = args.enabled
    invoke.resolve()
  }

  @Command
  fun getBatteryStatus(invoke: Invoke) {
    val battery = activity.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    invoke.resolve(JSObject().apply {
      if (level >= 0 && scale > 0 && level <= scale) {
        put("level", level.toDouble() / scale)
        put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING ||
          status == BatteryManager.BATTERY_STATUS_FULL)
      }
    })
  }

  @Command
  fun getNetworkStatus(invoke: Invoke) {
    val manager = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?
    // No connectivity manager, or no network at all: assume metered.
    val metered = manager?.isActiveNetworkMetered ?: true
    invoke.resolve(JSObject().apply { put("metered", metered) })
  }

  @Command
  fun exitApp(invoke: Invoke) {
    invoke.resolve()
    mainHandler.post { activity.moveTaskToBack(true) }
  }

  companion object {
    private const val BACK_EVENT = "back"
    private const val BACK_PROGRESS_EVENT = "backProgress"
    private const val VOLUME_KEY_EVENT = "volumeKey"
    private const val LIFECYCLE_EVENT = "lifecycle"
    private const val INCOMING_EVENT = "incomingBooks"
    private const val INSETS_EVENT = "insets"
    private const val INCOMING_DIR = "incoming-books"
    private const val INCOMING_FONTS_DIR = "incoming-fonts"
    private const val HANDLED_EXTRA = "com.maplume.litera.platform.HANDLED"
    private const val EPUB_MIME = "application/epub+zip"
    private val FONT_MIMES = arrayOf(
      "font/ttf",
      "font/otf",
      "font/sfnt",
      "application/x-font-ttf",
      "application/x-font-otf",
      "application/font-sfnt",
      "application/vnd.ms-opentype",
      "application/octet-stream",
    )
  }
}
