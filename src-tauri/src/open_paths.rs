use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

pub const OPEN_PATHS_EVENT: &str = "open-paths-available";

pub struct OpenedPaths(Mutex<Vec<PathBuf>>);

impl Default for OpenedPaths {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

pub fn is_epub_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
}

fn looks_like_url(arg: &str) -> bool {
    let bytes = arg.as_bytes();
    if bytes.len() >= 5 && bytes[..5].eq_ignore_ascii_case(b"file:") {
        return true;
    }
    arg.contains("://")
}

fn parse_file_url(arg: &str) -> Option<PathBuf> {
    let url = tauri::Url::parse(arg).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    url.to_file_path().ok()
}

fn normalize_path(path: PathBuf) -> PathBuf {
    // Follow real files so relative/`..` paths stabilize, but leave symlinks
    // intact so `import_paths` can reject them with the same InvalidInput.
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => path,
        _ => path.canonicalize().unwrap_or(path),
    }
}

fn extend_unique(queue: &mut Vec<PathBuf>, paths: Vec<PathBuf>) -> usize {
    let mut added = 0;
    for path in paths {
        if queue.iter().any(|existing| existing == &path) {
            continue;
        }
        queue.push(path);
        added += 1;
    }
    added
}

pub fn parse_open_arg(arg: &str, cwd: &Path) -> Option<PathBuf> {
    if arg.starts_with('-') {
        return None;
    }
    let path = if looks_like_url(arg) {
        parse_file_url(arg)?
    } else {
        let candidate = PathBuf::from(arg);
        if candidate.is_absolute() {
            candidate
        } else {
            cwd.join(candidate)
        }
    };
    if !is_epub_path(&path) {
        return None;
    }
    Some(normalize_path(path))
}

pub fn parse_open_args<I, S>(args: I, cwd: &Path) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut iter = args.into_iter();
    iter.next();
    iter.filter_map(|arg| parse_open_arg(arg.as_ref(), cwd))
        .collect()
}

pub fn parse_opened_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter_map(|url| {
            if url.scheme() != "file" {
                return None;
            }
            let path = url.to_file_path().ok()?;
            if !is_epub_path(&path) {
                return None;
            }
            Some(normalize_path(path))
        })
        .collect()
}

pub fn drain_pending(state: &OpenedPaths) -> Vec<String> {
    let mut queue = state.0.lock().unwrap_or_else(|error| error.into_inner());
    std::mem::take(&mut *queue)
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

pub fn enqueue_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<OpenedPaths>() else {
        return;
    };
    let added = {
        let mut queue = state.0.lock().unwrap_or_else(|error| error.into_inner());
        extend_unique(&mut queue, paths)
    };
    if added == 0 {
        return;
    }
    let _ = app.emit(OPEN_PATHS_EVENT, ());
}

pub fn enqueue_opened_urls(app: &AppHandle, urls: &[tauri::Url]) {
    enqueue_paths(app, parse_opened_urls(urls));
}

pub fn enqueue_current_process_args(app: &AppHandle) {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    enqueue_paths(app, parse_open_args(std::env::args(), &cwd));
}

pub fn handle_second_instance(app: &AppHandle, args: Vec<String>, cwd: impl AsRef<Path>) {
    enqueue_paths(app, parse_open_args(args, cwd.as_ref()));
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, OpenedPaths>) -> Vec<String> {
    drain_pending(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn parses_file_url() {
        let cwd = PathBuf::from("/tmp");
        let path = parse_open_arg("file:///Users/me/book.epub", &cwd).expect("file url");
        assert_eq!(path, PathBuf::from("/Users/me/book.epub"));
    }

    #[cfg(unix)]
    #[test]
    fn parses_percent_encoded_file_url() {
        let cwd = PathBuf::from("/tmp");
        let path = parse_open_arg("file:///Users/me/My%20Book.epub", &cwd).expect("encoded url");
        assert_eq!(path, PathBuf::from("/Users/me/My Book.epub"));
    }

    #[cfg(windows)]
    #[test]
    fn parses_file_url() {
        let cwd = PathBuf::from("C:\\");
        let path = parse_open_arg("file:///C:/temp/book.epub", &cwd).expect("file url");
        assert_eq!(path, PathBuf::from("C:\\temp\\book.epub"));
    }

    #[test]
    fn joins_relative_path_with_cwd_when_missing() {
        let cwd = PathBuf::from("/does-not-exist-cwd");
        let path = parse_open_arg("Tale.epub", &cwd).expect("relative epub");
        assert_eq!(path, cwd.join("Tale.epub"));
    }

    #[test]
    fn accepts_uppercase_epub_extension() {
        let cwd = PathBuf::from("/books");
        let path = parse_open_arg("Novel.EPUB", &cwd).expect("uppercase extension");
        assert_eq!(path, cwd.join("Novel.EPUB"));
    }

    #[test]
    fn skips_flags_non_epub_and_other_schemes() {
        let cwd = PathBuf::from("/cwd");
        assert!(parse_open_arg("--flag", &cwd).is_none());
        assert!(parse_open_arg("-v", &cwd).is_none());
        assert!(parse_open_arg("/cwd/notes.txt", &cwd).is_none());
        assert!(parse_open_arg("https://example.com/book.epub", &cwd).is_none());
    }

    #[test]
    fn drops_argv0_and_keeps_epub_args() {
        let cwd = PathBuf::from("/cwd");
        let paths = parse_open_args(
            [
                "/Applications/Litera.app/Contents/MacOS/litera",
                "--flag",
                "-v",
                "/cwd/notes.txt",
                "/cwd/book.EPUB",
                "https://example.com/x.epub",
            ],
            &cwd,
        );
        assert_eq!(paths, vec![PathBuf::from("/cwd/book.EPUB")]);
    }

    #[cfg(unix)]
    #[test]
    fn skips_non_file_opened_urls() {
        let file = tauri::Url::parse("file:///tmp/keep.epub").expect("file url");
        let https = tauri::Url::parse("https://example.com/skip.epub").expect("https url");
        let paths = parse_opened_urls(&[file, https]);
        assert_eq!(paths, vec![PathBuf::from("/tmp/keep.epub")]);
    }

    #[test]
    fn take_drains_queue_and_second_take_is_empty() {
        let state = OpenedPaths::default();
        state
            .0
            .lock()
            .expect("lock")
            .push(PathBuf::from("/tmp/a.epub"));
        let first = drain_pending(&state);
        let second = drain_pending(&state);
        assert_eq!(first, vec!["/tmp/a.epub".to_string()]);
        assert!(second.is_empty());
    }

    #[test]
    fn extend_unique_skips_paths_already_queued() {
        let mut queue = vec![PathBuf::from("/tmp/a.epub")];
        let added = extend_unique(
            &mut queue,
            vec![PathBuf::from("/tmp/a.epub"), PathBuf::from("/tmp/b.epub")],
        );
        assert_eq!(added, 1);
        assert_eq!(
            queue,
            vec![PathBuf::from("/tmp/a.epub"), PathBuf::from("/tmp/b.epub")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("real.epub");
        std::fs::write(&target, b"epub").expect("write");
        let link = dir.path().join("alias.epub");
        symlink(&target, &link).expect("symlink");

        let parsed = parse_open_arg(link.to_str().expect("utf8"), dir.path()).expect("parsed");
        assert_eq!(parsed, link);
        assert!(parsed
            .symlink_metadata()
            .expect("metadata")
            .file_type()
            .is_symlink());
    }
}
