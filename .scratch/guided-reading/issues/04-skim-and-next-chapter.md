# 04: Skim chapter and next chapter

**Status:** resolved

**What to build:** Two more guided actions beside Continue: "Skim this chapter" retells all remaining parts of the current chapter in one compressed step (`mode: "skim"`), and "Next chapter" moves the cursor to the next chapter without calling the model.

- [x] Skim sends one step that reads every remaining part of the chapter; the retelling states it was compressed
- [x] Next chapter records a cursor move without a model call (e.g. a marker entry), visible in the transcript as a small divider
- [x] Tests: cursor after skim and after next chapter

## Comments

- Changed from the plan: "Next chapter" (now **跳过本章 / Skip this chapter**) writes nothing and shows no divider. It only changes the step the Continue button will send; the step, once sent, records the position itself. A skip never followed by a step leaves no trace, which is the point.
- A skim step is `{ ...step, skim: true }`, from the next step's part to the chapter's end. The cursor then counts the whole chapter as covered.
- Both act on the *next* step's chapter, so before the guide starts they work on the start chapter too.
