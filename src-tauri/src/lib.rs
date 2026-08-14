use tauri::Manager;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

mod agent_config;
mod error;
mod library;
mod open_paths;
mod pi_sessions;
mod preferences;

use library::LibraryStore;
use preferences::PreferencesStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                open_paths::handle_second_instance(app, args, cwd);
            }))
            .plugin(
                WindowStateBuilder::default()
                    .with_state_flags(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    )
                    .build(),
            );
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(open_paths::OpenedPaths::default())
        .setup(|app| {
            let root_result = app.path().app_data_dir().map_err(|error| {
                error::AppError::storage_io(format!("Failed to resolve app data dir: {error}"))
            });
            let (library_store, preferences_store) = match root_result {
                Ok(root) => {
                    let library_result =
                        tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking({
                            let root = root.clone();
                            move || LibraryStore::initialize(root)
                        }))
                        .map_err(|error| {
                            error::AppError::storage_io(format!(
                                "Library initialization worker failed: {error}"
                            ))
                        })
                        .and_then(|result| result);
                    let preferences_result = PreferencesStore::initialize(root.clone());
                    match library_result {
                        Ok(store) => (
                            store,
                            preferences_result.unwrap_or_else(|error| {
                                eprintln!("[preferences] Initialization failed: {error}");
                                PreferencesStore::unavailable()
                            }),
                        ),
                        Err(error) => {
                            eprintln!("[library] Initialization failed: {error}");
                            (
                                LibraryStore::unavailable(root, error),
                                preferences_result.unwrap_or_else(|error| {
                                    eprintln!("[preferences] Initialization failed: {error}");
                                    PreferencesStore::unavailable()
                                }),
                            )
                        }
                    }
                }
                Err(error) => {
                    eprintln!("[library] Initialization failed: {error}");
                    (
                        LibraryStore::unavailable(std::path::PathBuf::new(), error),
                        PreferencesStore::unavailable(),
                    )
                }
            };
            app.manage(library_store);
            app.manage(preferences_store);

            open_paths::enqueue_current_process_args(app.handle());

            if let Some(window) = app.get_webview_window("main") {
                // Apply chrome while hidden so the native title bar never flashes.
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                    let _ = window.set_title("");
                }
                #[cfg(any(windows, target_os = "linux"))]
                {
                    let _ = window.set_decorations(false);
                }
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::import_book,
            library::import_paths,
            open_paths::take_pending_open_paths,
            library::discard_import,
            library::read_import_bytes,
            library::save_book_metadata,
            library::list_books,
            library::get_book_open_context,
            library::read_book_bytes,
            library::open_book_bytes,
            library::delete_book,
            library::update_reading_state,
            library::get_annotations,
            library::save_annotations,
            agent_config::get_agent_config,
            agent_config::get_agent_runtime_config,
            agent_config::save_agent_config,
            agent_config::add_custom_provider,
            agent_config::update_custom_provider,
            agent_config::delete_custom_provider,
            agent_config::switch_provider,
            agent_config::list_remote_models,
            preferences::get_preferences,
            preferences::save_preferences,
            preferences::list_system_fonts,
            pi_sessions::create_agent_session,
            pi_sessions::list_agent_sessions,
            pi_sessions::load_agent_session,
            pi_sessions::append_agent_session_entries,
            pi_sessions::delete_agent_session,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                open_paths::enqueue_opened_urls(_app, urls);
            }
        });
}
