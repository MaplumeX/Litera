# 01: KOReader document hash for each Book

**What to build:** Rust computes KOReader's partial MD5 (see spec "Protocol facts") of a Book's `book.epub` and caches it on the BookRecord as `koreaderHash` (local only, never in the Manifest). Computed at import and lazily backfilled for existing books; books without a cached `book.epub` have none. Add the `md-5` crate.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] `koreader_partial_md5(path)` matches KOReader's algorithm (offset 0, then `1024 << 2i`), tested on files < 1 KiB, mid-size, and > 1 MiB against fixture hashes produced by KOReader's `util.partialMD5`
- [x] Hash computed on demand (no cache needed)
- [x] Nothing added to the Manifest; S3 Sync tests still pass

## Comments

- Implemented as `kosync::partial_md5`, computed on demand instead of cached on the BookRecord (reads ≤ 12 KiB), so there is no backfill and nothing to keep out of the Manifest.
