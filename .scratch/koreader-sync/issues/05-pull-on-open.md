# 05: Pull remote position when a Book opens

**What to build:** On opening a Book (after the local position is restored), pull `GET {base}/syncs/progress/{koreaderHash}` once. Pure `shouldJump(local, remote, ownDeviceId)`: jump when the remote exists, comes from another device, its `timestamp` is newer than local `positionUpdatedAt`, and the percentage differs by > ~0.1 %. Navigate via `rangeFromXPointer` → CFI, falling back to `percentage`. The jump writes through the normal position path (so S3 Sync carries it). Before jumping, ask: a dialog "<device> is at 42% (you are at 17%). Jump there?" with Jump / Stay.

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [x] `shouldJump` table tests (own device, older, equal, tiny diff, missing)
- [x] Fallback to percentage when the XPointer does not resolve
- [x] Dialog offers Jump / Stay; Stay keeps the local position
- [x] English and Simplified Chinese copy
