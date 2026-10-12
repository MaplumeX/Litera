# 05: "Mark as finished" prompt in the reader

**What to build:** Reaching the end of a Book that is not finished shows a small non-modal prompt offering to mark it finished.

**Blocked by:** 02

**Status:** resolved

- [x] `BookOpenContext` carries `readingStatus`
- [x] Prompt appears when the position reaches `FINISH_FRACTION`, at most once per open, never for `finished` Books
- [x] "Mark as finished" sets the status through the status write path; dismissing changes nothing
- [x] i18n in both locales; tests for threshold, once-per-open, and the finished case
