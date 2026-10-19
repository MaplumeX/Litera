package com.maplume.litera

import android.graphics.Rect
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // The reader draws its own selection toolbar, so the WebView's floating
  // copy/share menu would stack on top of it. An empty menu keeps the
  // selection and its drag handles but never shows the floating toolbar.
  // The mode itself must live on: finishing it clears the WebView's selection.
  override fun onWindowStartingActionMode(callback: ActionMode.Callback, type: Int): ActionMode? {
    if (type != ActionMode.TYPE_FLOATING) return super.onWindowStartingActionMode(callback, type)
    return super.onWindowStartingActionMode(EmptyMenuCallback(callback), type)
  }
}

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
