//! Litera's Android platform bridge. The plugin has no Rust commands: Tauri
//! forwards every `plugin:litera-platform|…` invoke to the Kotlin
//! `PlatformPlugin`, which also emits the `back`, `volumeKey`, `lifecycle`
//! and `incomingBooks` events. Desktop registers nothing; the frontend bridge
//! is a no-op there.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.maplume.litera.platform";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("litera-platform")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "PlatformPlugin")?;
            Ok(())
        })
        .build()
}
