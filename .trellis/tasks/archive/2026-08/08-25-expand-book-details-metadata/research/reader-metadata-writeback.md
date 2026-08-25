# Do readers write metadata back into EPUB?

Sources checked 2026-08-25. Split **readers** (open/read a library) from **library managers / editors**.

## Readers: usually no

| App | Where edits live | Touches the EPUB? |
| --- | --- | --- |
| KOReader | `.sdr` sidecar (`custom_metadata.lua`) | **No.** User guide: Calibre changes metadata *in the book* so it is visible outside Calibre; KOReader only adds custom metadata next to the file. Third-party *Rebind* plugin exists *because* core KOReader will not rewrite OPF. |
| Foliate | `~/.local/share/.../Foliate/<id>.json` (progress, annotations, a metadata snapshot) | **No.** File is identified by OPF id or MD5; the EPUB is not rewritten. |
| Thorium | App-private copy + publication DB | **No.** FAQ: imports live in Thorium’s filesystem so bookmarks/settings/DRM attach reliably. No metadata-embed-on-save. |
| Readest | `library.json` (+ cached cover) | **No.** Maintainer: EPUB is parsed on import; later OPF edits in the books folder are ignored until re-import. Changing cover is a library action. |
| Apple Books | App library / Get Info | **Library overlay.** Users can rename title/author in the app; that does not reliably rewrite OPF. People use Calibre to change the file, then re-import. |

Pattern: a reader copies or indexes the file, shows a shelf from its own store, and leaves the publication bytes alone. Sidecar / DB edits travel with the *app*, not with a USB copy of the `.epub`.

## Calibre: yes, but not on ordinary edit

Calibre is the main counter-example, and even it **does not** write the library EPUB when you press E / Edit metadata.

Edits go into Calibre’s database (and a sidecar OPF in the library folder). The book file is updated only on explicit export-ish actions ([MobileRead, DoctorOhh, 2025-02](https://www.mobileread.com/forums/showthread.php?t=366058)):

- Send to device
- Save to disk
- Email
- Convert
- **Embed metadata**
- Polish (checkbox: update metadata in the book files)
- Modify EPUB / Book Editor save

This mismatch is a long-running user surprise: “I edited metadata in Calibre but the EPUB still has the old title.”

Cover in Calibre is also a library asset; embedding into the zip is part of polish/send, not the metadata dialog itself.

## Editors

Sigil / Calibre Book Editor rewrite the EPUB because they are **file editors**, not shelves. Out of scope for a reader details dialog.

## Cover

Readers that show a custom cover keep it as a sidecar or cache (KOReader `.sdr`, Foliate cover cache, Litera `cover.jpg`). Injecting a new image into the zip + OPF `cover-image` is editor/polish territory.

## Implication for Litera

Litera is a desktop reader with a shelf (`library.json` + `books/<id>/book.epub` copy), same class as Foliate / Thorium / Readest, not Calibre.

Default that matches peers: **details save updates the shelf only**. Writing OPF is an extra, explicit “embed” if we ever need the copy-out-the-epub story. Automatic dual-write on every Save:

- changes `contentHash` and import duplicate detection
- can corrupt odd/DRM/malformed zips
- still does not update the user’s original file (Litera does not keep that path writable)

If the product later needs Calibre-like portability, add a separate action, not implicit save.
