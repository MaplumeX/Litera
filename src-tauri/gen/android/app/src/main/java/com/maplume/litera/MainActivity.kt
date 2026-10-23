package com.maplume.litera

import android.content.Context
import android.graphics.Rect
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  private val selectionMenu = SelectionMenuSwitch()

  // Wry installs the WebView with setContentView(View). Intercept selection
  // requests in its parent, before DecorView captures the callback. Wrapping
  // it in onWindowStartingActionMode is too late: super returns null for a
  // floating mode and DecorView falls back to its original callback.
  override fun setContentView(view: View?) {
    if (view !is WebView) {
      super.setContentView(view)
      return
    }
    // Same task as Wry's loadUrl, so the first page already sees it.
    view.addJavascriptInterface(selectionMenu, "literaSelectionMenu")
    val container = SelectionActionModeLayout(this, selectionMenu)
    container.addView(view, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT,
    ))
    super.setContentView(container)
  }
}

// The reader draws its own selection toolbar, so the WebView's floating menu
// would stack on top of it there. Elsewhere (the assistant chat, inputs) the
// native menu is the only one. The page flips this on every touch, well
// before a long press starts the selection.
private class SelectionMenuSwitch {
  @Volatile var hidden = false
    private set

  @JavascriptInterface
  fun setHidden(hidden: Boolean) {
    this.hidden = hidden
  }
}

private class SelectionActionModeLayout(
  context: Context,
  private val switch: SelectionMenuSwitch,
) : FrameLayout(context) {
  override fun startActionModeForChild(
    originalView: View,
    callback: ActionMode.Callback,
    type: Int,
  ): ActionMode? {
    val selectionCallback =
      if (type == ActionMode.TYPE_FLOATING) SwitchableMenuCallback(callback, switch) else callback
    return super.startActionModeForChild(originalView, selectionCallback, type)
  }
}

// Keep the mode and its callbacks alive for the native selection handles.
// Check on every prepare too: dragging can repopulate the menu, and a new
// selection elsewhere may reuse the running mode instead of starting one.
private class SwitchableMenuCallback(
  private val inner: ActionMode.Callback,
  private val switch: SelectionMenuSwitch,
) : ActionMode.Callback2() {
  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean =
    inner.onCreateActionMode(mode, menu).also { if (switch.hidden) menu.clear() }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean =
    inner.onPrepareActionMode(mode, menu).also { if (switch.hidden) menu.clear() }

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean =
    inner.onActionItemClicked(mode, item)

  override fun onDestroyActionMode(mode: ActionMode) = inner.onDestroyActionMode(mode)

  override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
    if (inner is ActionMode.Callback2) inner.onGetContentRect(mode, view, outRect)
    else super.onGetContentRect(mode, view, outRect)
  }
}
