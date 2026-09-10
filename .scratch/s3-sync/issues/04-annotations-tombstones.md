# 04: Annotations sync and tombstone propagation

**What to build:** A reader's Annotations (bookmarks, highlights with colors, notes) follow them across devices: after a sync, highlights created on device A appear on B, and vice versa, with the union preserving both sides. Deleting a single highlight propagates so it is not resurrected by a later merge. Deleting a whole book on one device propagates via its Tombstone: the other device moves the book into its local trash, and the cloud object set is cleaned up after the 30-day retention window (any device may opportunistically purge expired Tombstones). Verifiable: highlight on one machine, sync both, see it on the other; delete a highlight or a book, sync, and the deletion holds everywhere.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [ ] Annotations created on one device appear on the other after sync (union by id)
- [ ] A single deleted highlight stays deleted on the other device after sync (per-item Tombstone beats union-resurrection)
- [ ] A deleted book propagates: other devices move it into their local trash (local trash never itself syncs)
- [ ] Tombstones expire after 30 days and can be purged opportunistically by any syncing device
- [ ] Annotation merge outcomes covered by merge-engine tests; sync wiring covered by app-level tests
