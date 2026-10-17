package com.maplume.litera.platform

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.KeyEvent
import android.view.Window
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
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
 * `volumeKey`, `lifecycle`, `incomingBooks`. Commands: the document picker,
 * immersive mode, keep-screen-on, volume-key interception, network type and
 * leaving the app.
 *
 * Picked and shared EPUBs are copied into `cacheDir/incoming-books/` and
 * handed to the WebView as `{ name, path }`; the Rust import command reads
 * and deletes them. Bytes never cross the JSON bridge.
 */
@TauriPlugin
class PlatformPlugin(private val activity: Activity) : Plugin(activity) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val incomingLock = Any()
  // Books that arrived before the WebView listened (a cold start "Open with").
  private val pendingIncoming = mutableListOf<JSObject>()
  @Volatile private var volumeKeyPaging = false
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

  override fun onResume(activity: AppCompatActivity) {
    trigger(LIFECYCLE_EVENT, JSObject().apply { put("state", "foreground") })
  }

  override fun onPause(activity: AppCompatActivity) {
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
   * the visible insets are published as CSS variables (in CSS px). Hidden
   * bars (immersive mode) report zero.
   */
  private fun publishInsets(webView: WebView) {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val density = view.resources.displayMetrics.density
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val top = bars.top / density
      val bottom = maxOf(bars.bottom, ime.bottom) / density
      val left = bars.left / density
      val right = bars.right / density
      val script = "(function(s){" +
        "s.setProperty('--android-inset-top','${top}px');" +
        "s.setProperty('--android-inset-bottom','${bottom}px');" +
        "s.setProperty('--android-inset-left','${left}px');" +
        "s.setProperty('--android-inset-right','${right}px');" +
        "})(document.documentElement.style)"
      view.post { (view as WebView).evaluateJavascript(script, null) }
      ViewCompat.onApplyWindowInsets(view, insets)
    }
    ViewCompat.requestApplyInsets(webView)
  }

  // --- Incoming books ------------------------------------------------------

  private fun handleIntent(intent: Intent?) {
    if (intent == null || intent.getBooleanExtra(HANDLED_EXTRA, false)) return
    val uris = incomingUris(intent)
    if (uris.isEmpty()) return
    // Never import the same intent twice (activity recreation re-delivers it).
    intent.putExtra(HANDLED_EXTRA, true)
    io.execute {
      val books = JSArray()
      for (uri in uris) books.put(copyToCache(uri))
      deliverIncoming(JSObject().apply { put("books", books) })
    }
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

  /** `{ name, path }` on success, `{ name, error }` when the file can't be read. */
  private fun copyToCache(uri: Uri): JSObject {
    val name = displayName(uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "book.epub"
    return try {
      val dir = File(activity.cacheDir, INCOMING_DIR)
      if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Cannot create $dir")
      val file = File(dir, UUID.randomUUID().toString() + ".epub")
      val input = activity.contentResolver.openInputStream(uri)
        ?: throw IOException("Cannot open $uri")
      input.use { stream -> file.outputStream().use { stream.copyTo(it) } }
      JSObject().apply {
        put("name", name)
        put("path", file.absolutePath)
      }
    } catch (ex: Exception) {
      Logger.error("Failed to read incoming book: ${ex.message}")
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
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(EPUB_MIME))
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      startActivityForResult(invoke, intent, "pickBooksResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "Failed to open the file picker")
    }
  }

  @ActivityCallback
  fun pickBooksResult(invoke: Invoke, result: ActivityResult) {
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) {
      // Cancelling the picker is not an error.
      invoke.resolve(JSObject().apply { put("books", JSArray()) })
      return
    }
    val uris = mutableListOf<Uri>()
    val clip = data.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
    } else {
      data.data?.let { uris.add(it) }
    }
    io.execute {
      val books = JSArray()
      for (uri in uris) books.put(copyToCache(uri))
      invoke.resolve(JSObject().apply { put("books", books) })
    }
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
    private const val VOLUME_KEY_EVENT = "volumeKey"
    private const val LIFECYCLE_EVENT = "lifecycle"
    private const val INCOMING_EVENT = "incomingBooks"
    private const val INCOMING_DIR = "incoming-books"
    private const val HANDLED_EXTRA = "com.maplume.litera.platform.HANDLED"
    private const val EPUB_MIME = "application/epub+zip"
  }
}
