use tauri::Manager;

mod agent_config;
mod error;
mod library;
mod open_paths;
mod preferences;
mod sidecar;
mod sidecar_protocol;

use library::LibraryStore;
use preferences::PreferencesStore;
use sidecar::SidecarSupervisor;

pub(crate) fn notify_sidecar_book_opened(
    app: &tauri::AppHandle,
    path: &str,
    book_id: &str,
) -> error::AppResult<()> {
    sidecar::notify_book_opened(app, path, book_id).map_err(|error| {
        error::AppError::storage_io(format!("Failed to notify agent about opened book: {error}"))
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_paths::handle_second_instance(app, args, cwd);
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(open_paths::OpenedPaths::default())
        .setup(|app| {
            let root_result = app.path().app_data_dir().map_err(|error| {
                error::AppError::storage_io(format!("Failed to resolve app data dir: {error}"))
            });
            let (library_store, library_ready, preferences_store) = match root_result {
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
                            true,
                            preferences_result.unwrap_or_else(|error| {
                                eprintln!("[preferences] Initialization failed: {error}");
                                PreferencesStore::unavailable()
                            }),
                        ),
                        Err(error) => {
                            eprintln!("[library] Initialization failed: {error}");
                            (
                                LibraryStore::unavailable(root, error),
                                false,
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
                        false,
                        PreferencesStore::unavailable(),
                    )
                }
            };
            app.manage(library_store);
            app.manage(preferences_store);

            let supervisor = if library_ready {
                SidecarSupervisor::start(app.handle().clone())
            } else {
                eprintln!("[sidecar] Not started because library initialization failed");
                SidecarSupervisor::unavailable("Library initialization failed")
            };
            app.manage(supervisor);
            open_paths::enqueue_current_process_args(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(supervisor) = window.app_handle().try_state::<SidecarSupervisor>() {
                    supervisor.shutdown();
                }
            }
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
            sidecar::get_agent_snapshot,
            sidecar::agent_prompt,
            sidecar::agent_edit_prompt,
            sidecar::agent_abort,
            sidecar::list_sessions,
            sidecar::new_session,
            sidecar::switch_session,
            sidecar::delete_session,
            sidecar::rename_session,
            sidecar::close_book,
            sidecar::restart_sidecar,
            agent_config::get_agent_config,
            agent_config::save_agent_config,
            agent_config::add_custom_provider,
            agent_config::update_custom_provider,
            agent_config::delete_custom_provider,
            agent_config::switch_provider,
            agent_config::list_remote_models,
            preferences::get_preferences,
            preferences::save_preferences,
            preferences::list_system_fonts,
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
