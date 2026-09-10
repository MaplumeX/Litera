# 06: Session sync with branch preservation

**What to build:** A reader's assistant Sessions follow them across devices: conversations continue on another machine, including their summaries and per-session system prompts (which are appended to the default, so reading tools stay intact). When two devices each chatted about the same book in diverging directions, the merge keeps both branches — neither conversation is silently dropped, and the existing session branch UI can navigate them. Verifiable: chat about a book on one machine, sync both, continue that conversation on the other; chat divergently on two machines, sync, and both branches are present.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [ ] Sessions created on one device appear and continue on another after sync
- [ ] Session summaries and per-session system prompts sync along with the messages
- [ ] Diverged Sessions keep both branches after merge; neither side's conversation is lost
- [ ] API keys never sync (provider settings syncing is ticket 07; keys stay per-device)
- [ ] Branch-preservation behavior covered by merge-engine tests; wiring covered by app-level tests
