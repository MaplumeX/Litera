//! EPUB cover extraction, thumbnail generation with overlay, and disk caching.
//!
//! Adapted from readest's `windows-thumbnail` extension, simplified to EPUB only
//! and using `SHGetKnownFolderPath` instead of `directories-next`.

use anyhow::{anyhow, Result};
use image::{imageops, DynamicImage, Rgba};
use md5::Md5;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::UI::Shell::{
    SHGetKnownFolderPath, KF_FLAG_DEFAULT, KnownFolderId,
};
use zip::ZipArchive;

use md5::Digest;

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail cache directory (per-user)
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve the thumbnail cache directory:
/// `%LOCALAPPDATA%\com.maplume.litera\thumbnails\`
fn cache_dir() -> Option<std::path::PathBuf> {
    unsafe {
        let pwsz = SHGetKnownFolderPath(&KnownFolderId::FOLDERID_LocalAppData, KF_FLAG_DEFAULT, None).ok()?;
        let path = pwsz.to_string().ok()?;
        let dir = Path::new(&path)
            .join("com.maplume.litera")
            .join("thumbnails");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EPUB extraction
// ─────────────────────────────────────────────────────────────────────────────

/// Extract cover image bytes from an EPUB file using a 4-pass strategy:
/// 1. ZIP entries whose name contains "cover" or "front"
/// 2. OPF `properties="cover-image"` / `<meta name="cover">` declaration
/// 3. First image in the OPF manifest
/// 4. Largest image file in the archive
pub fn extract_epub_cover_bytes<R: Read + Seek>(reader: R) -> Result<Vec<u8>> {
    let mut archive = ZipArchive::new(reader)?;

    // Pass 1: filename-based heuristics
    let mut candidates: Vec<(usize, String, u64)> = Vec::new();
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_lowercase();
        let size = file.size();
        drop(file);

        if is_image_extension(&name) && (name.contains("cover") || name.contains("front")) {
            candidates.push((i, name, size));
        }
    }

    if !candidates.is_empty() {
        // Exact "cover." match first, then largest size.
        candidates.sort_by(|a, b| {
            let a_exact = a.1.contains("cover.") || a.1.ends_with("cover");
            let b_exact = b.1.contains("cover.") || b.1.ends_with("cover");
            match (a_exact, b_exact) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => b.2.cmp(&a.2),
            }
        });

        let idx = candidates[0].0;
        let mut file = archive.by_index(idx)?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        return Ok(buf);
    }

    // Pass 2: OPF manifest / metadata
    let container_xml = read_zip_file_to_string(&mut archive, "META-INF/container.xml");
    if let Ok(xml) = container_xml {
        if let Some(rootfile) = extract_attribute(&xml, "rootfile", "full-path") {
            let opf_content = read_zip_file_to_string(&mut archive, &rootfile);
            if let Ok(opf) = opf_content {
                if let Some(cover_id) = find_cover_id_in_opf(&opf) {
                    if let Some(href) = find_href_by_id_in_opf(&opf, &cover_id) {
                        let base = Path::new(&rootfile).parent().unwrap_or(Path::new(""));
                        let cover_path = base.join(&href).to_string_lossy().replace('\\', "/");
                        if let Ok(bytes) = read_zip_file_to_bytes(&mut archive, &cover_path) {
                            return Ok(bytes);
                        }
                    }
                }
                if let Some(href) = find_first_image_in_manifest(&opf) {
                    let base = Path::new(&rootfile).parent().unwrap_or(Path::new(""));
                    let cover_path = base.join(&href).to_string_lossy().replace('\\', "/");
                    if let Ok(bytes) = read_zip_file_to_bytes(&mut archive, &cover_path) {
                        return Ok(bytes);
                    }
                }
            }
        }
    }

    // Pass 3 (design "Pass 4"): largest image in the archive
    let mut largest: Option<(usize, u64)> = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_lowercase();
        let size = file.size();
        drop(file);

        if is_image_extension(&name) && (largest.is_none() || size > largest.unwrap().1) {
            largest = Some((i, size));
        }
    }

    if let Some((idx, _)) = largest {
        let mut file = archive.by_index(idx)?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        return Ok(buf);
    }

    Err(anyhow!("No cover image found in EPUB"))
}

/// Extract cover image bytes from an EPUB file on disk.
fn extract_cover_bytes_from_path(path: &Path) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path)?;
    extract_epub_cover_bytes(file)
}

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail creation with overlay
// ─────────────────────────────────────────────────────────────────────────────

/// Create a thumbnail from cover image bytes with the Litera icon overlay.
pub fn create_thumbnail_with_overlay(cover_bytes: &[u8], requested_size: u32) -> Result<Vec<u8>> {
    let img = image::load_from_memory(cover_bytes)?;
    let thumbnail = img.thumbnail(requested_size, requested_size);

    let overlay_img = load_overlay_icon();

    let mut base = thumbnail.to_rgba8();
    let (base_w, base_h) = (base.width(), base.height());

    if let Some(ov) = overlay_img {
        let overlay_size = (requested_size / 5).clamp(24, 48);
        let ov_resized = ov.resize(overlay_size, overlay_size, imageops::FilterType::Lanczos3);
        let ovb = ov_resized.to_rgba8();
        let (ov_w, ov_h) = (ovb.width(), ovb.height());

        let x = base_w.saturating_sub(ov_w + 4);
        let y = base_h.saturating_sub(ov_h + 4);

        for oy in 0..ov_h {
            for ox in 0..ov_w {
                let dst_x = x + ox;
                let dst_y = y + oy;

                if dst_x < base_w && dst_y < base_h {
                    let src_pixel = ovb.get_pixel(ox, oy);
                    let alpha = src_pixel.0[3] as f32 / 255.0;

                    if alpha > 0.0 {
                        let dst_pixel = base.get_pixel(dst_x, dst_y);
                        let mut result = dst_pixel.0;

                        for c in 0..3 {
                            let fg = src_pixel.0[c] as f32;
                            let bg = result[c] as f32;
                            result[c] = (fg * alpha + bg * (1.0 - alpha)) as u8;
                        }
                        result[3] = 255;

                        base.put_pixel(dst_x, dst_y, Rgba(result));
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    DynamicImage::ImageRgba8(base).write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)?;
    Ok(out)
}

/// Load the Litera overlay icon (embedded at compile time).
fn load_overlay_icon() -> Option<DynamicImage> {
    // src-tauri/windows-thumbnail/src/extraction.rs -> ../../icons/128x128.png
    let icon_bytes = include_bytes!("../../icons/128x128.png");
    image::load_from_memory(icon_bytes).ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// Caching
// ─────────────────────────────────────────────────────────────────────────────

/// Generate a thumbnail with disk caching.
///
/// The cache key is a partial MD5 of the file (extension + requested size +
/// 1 KB chunks sampled at exponentially increasing offsets), matching the
/// readest partial-hash strategy.
pub fn cached_thumbnail_for_path(path: &Path, ext: &str, size: u32) -> Result<Vec<u8>> {
    let mut hasher = Md5::new();
    hasher.update(ext.as_bytes());
    hasher.update(&size.to_le_bytes());

    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    let file_len = metadata.len();

    const STEP: u64 = 1024;
    const SIZE: u64 = 1024;
    let mut file = file;

    for i in -1i32..=10 {
        let pos = if i == -1 {
            256u64
        } else {
            STEP << (2 * i as u32)
        };
        let start = pos.min(file_len);
        let end = (start + SIZE).min(file_len);

        if start >= file_len {
            break;
        }

        file.seek(SeekFrom::Start(start))?;
        let mut buf = vec![0u8; (end - start) as usize];
        file.read_exact(&mut buf)?;
        hasher.update(&buf);
    }

    let digest = hasher.finalize();
    let key = format!("{:x}.png", digest);

    if let Some(ref dir) = cache_dir() {
        let cache_path = dir.join(&key);
        if cache_path.exists() {
            if let Ok(cached) = std::fs::read(&cache_path) {
                return Ok(cached);
            }
        }
    }

    let cover = extract_cover_bytes_from_path(path)?;
    let thumbnail = create_thumbnail_with_overlay(&cover, size)?;

    if let Some(ref dir) = cache_dir() {
        let cache_path = dir.join(&key);
        let _ = std::fs::write(&cache_path, &thumbnail);
    }

    Ok(thumbnail)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

fn is_image_extension(name: &str) -> bool {
    name.ends_with(".jpg")
        || name.ends_with(".jpeg")
        || name.ends_with(".png")
        || name.ends_with(".gif")
        || name.ends_with(".webp")
        || name.ends_with(".bmp")
}

fn read_zip_file_to_string<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<String> {
    let mut file = archive.by_name(name)?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    Ok(content)
}

fn read_zip_file_to_bytes<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>> {
    let mut file = archive.by_name(name)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Extract a single attribute value from the first occurrence of `<tag ...>`
/// in `xml`.  Simple string-scan parser (OPF/container.xml are simple enough).
fn extract_attribute(xml: &str, tag: &str, attr: &str) -> Option<String> {
    let pattern = format!("<{}", tag);
    let tag_pos = xml.find(&pattern)?;
    let tag_end = xml[tag_pos..].find('>').unwrap_or(500) + tag_pos;
    let tag_content = &xml[tag_pos..tag_end];

    let attr_pattern = format!("{}=\"", attr);
    let attr_pos = tag_content.find(&attr_pattern)?;
    let value_start = attr_pos + attr_pattern.len();
    let value_end = tag_content[value_start..].find('"')?;
    Some(tag_content[value_start..value_start + value_end].to_string())
}

/// Find the cover image id in an OPF document.
///
/// Checks EPUB3 `properties="cover-image"` first, then EPUB2
/// `<meta name="cover" content="<id>"/>`.
fn find_cover_id_in_opf(opf: &str) -> Option<String> {
    // EPUB2: <meta name="cover" content="<id>" />
    if let Some(pos) = opf.find("name=\"cover\"") {
        let window_start = pos.saturating_sub(50);
        let window_end = (pos + 100).min(opf.len());
        let window = &opf[window_start..window_end];

        if let Some(content_pos) = window.find("content=\"") {
            let start = content_pos + 9;
            if let Some(end) = window[start..].find('"') {
                return Some(window[start..start + end].to_string());
            }
        }
    }

    // EPUB3: properties="cover-image" on a manifest <item id="...">
    if let Some(pos) = opf.find("properties=\"cover-image\"") {
        let window_start = pos.saturating_sub(200);
        let window = &opf[window_start..pos];

        if let Some(id_pos) = window.rfind("id=\"") {
            let start = id_pos + 4;
            if let Some(end) = window[start..].find('"') {
                return Some(window[start..start + end].to_string());
            }
        }
    }

    None
}

/// Find the `href` attribute of the manifest item with the given `id`.
fn find_href_by_id_in_opf(opf: &str, id: &str) -> Option<String> {
    let pattern = format!("id=\"{}\"", id);
    let pos = opf.find(&pattern)?;
    let window_start = pos.saturating_sub(10);
    let window_end = (pos + 200).min(opf.len());
    let window = &opf[window_start..window_end];

    let href_pos = window.find("href=\"")?;
    let start = href_pos + 6;
    let end = window[start..].find('"')?;
    Some(window[start..start + end].to_string())
}

/// Find the first image href in the OPF `<manifest>` section.
fn find_first_image_in_manifest(opf: &str) -> Option<String> {
    let manifest_start = opf.find("<manifest")?;
    let manifest_end = opf[manifest_start..]
        .find("</manifest>")
        .map(|e| manifest_start + e)?;
    let manifest = &opf[manifest_start..manifest_end];

    for media_type in ["image/jpeg", "image/png", "image/gif", "image/webp"] {
        let pattern = format!("media-type=\"{}\"", media_type);
        if let Some(pos) = manifest.find(&pattern) {
            let window_start = pos.saturating_sub(200);
            let window = &manifest[window_start..pos];

            if let Some(href_pos) = window.rfind("href=\"") {
                let start = href_pos + 6;
                if let Some(end) = window[start..].find('"') {
                    return Some(window[start..start + end].to_string());
                }
            }
        }
    }

    None
}