package com.maplume.litera

import android.content.Context
import android.graphics.Rect
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Wry installs the WebView with setContentView(View). Intercept selection
  // requests in its parent, before DecorView captures the callback. Wrapping
  // it in onWindowStartingActionMode is too late: super returns null for a
  // floating mode and DecorView falls back to its original callback.
  override fun setContentView(view: View?) {
    if (view !is WebView) {
      super.setContentView(view)
      return
    }
    val container = SelectionActionModeLayout(this)
    container.addView(view, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT,
    ))
    super.setContentView(container)
  }
}

private class SelectionActionModeLayout(context: Context) : FrameLayout(context) {
  override fun startActionModeForChild(
    originalView: View,
    callback: ActionMode.Callback,
    type: Int,
  ): ActionMode? {
    val selectionCallback = if (type == ActionMode.TYPE_FLOATING) EmptyMenuCallback(callback) else callback
    return super.startActionModeForChild(originalView, selectionCallback, type)
  }
}

// Keep the mode and its callbacks alive for the native selection handles.
// Clear on every prepare too, since dragging can repopulate the menu.
private class EmptyMenuCallback(private val inner: ActionMode.Callback) : ActionMode.Callback2() {
  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean =
    inner.onCreateActionMode(mode, menu).also { menu.clear() }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean =
    inner.onPrepareActionMode(mode, menu).also { menu.clear() }

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean =
    inner.onActionItemClicked(mode, item)

  override fun onDestroyActionMode(mode: ActionMode) = inner.onDestroyActionMode(mode)

  override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
    if (inner is ActionMode.Callback2) inner.onGetContentRect(mode, view, outRect)
    else super.onGetContentRect(mode, view, outRect)
  }
}
