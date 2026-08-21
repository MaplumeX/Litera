# Windows Thumbnail Provider for Litera

A Windows Shell `IThumbnailProvider` implementation that shows EPUB book covers
as file thumbnails in Windows Explorer when Litera is set as the default
application for `.epub` files.

## Features

- **Cover extraction**: Extracts cover images from EPUB files by parsing the
  ZIP archive and OPF manifest (4-pass strategy: filename → OPF properties/meta
  → manifest first image → largest image).
- **Independent thumbnail cache**: Caches generated thumbnails keyed by a
  partial content hash of the EPUB file, stored in
  `%LOCALAPPDATA%\com.maplume.litera\thumbnails\`.
- **File-association aware**: Only provides thumbnails when Litera is the
  default app for `.epub`; otherwise returns `S_FALSE` so Explorer falls back
  to the default icon.
- **Branding overlay**: Adds a small Litera icon at the bottom-right corner.

## CLSID

`{A2A296FA-9317-44A3-A371-6A883CAA1F33}`

## Building (Windows only)

```bash
cd src-tauri/windows-thumbnail
cargo build --release
```

The resulting `windows_thumbnail.dll` is bundled via `tauri.conf.json`
`bundle.resources` and auto-registered by the NSIS installer hooks.

## Manual registration (development)

```bash
regsvr32 /s target\release\windows_thumbnail.dll   # register
regsvr32 /s /u target\release\windows_thumbnail.dll  # unregister
ie4uinit.exe -show                                   # refresh Explorer
```

Registration writes to `HKCU\Software\Classes` (current-user) so no
administrator privileges are required.