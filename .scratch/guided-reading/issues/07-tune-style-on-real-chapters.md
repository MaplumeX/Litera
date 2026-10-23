# 07: Tune the style on real chapters

**Status:** resolved

**What to build:** Run the default guided style prompt on real chapters from a book the reader is reading, review the output with them, and adjust the prompt until the retelling matches the spec's target style.

- [x] Reader picks the book and chapters
- [x] At least one full chapter retold step by step and reviewed
- [x] Prompt adjusted and the final version committed as the default

**Notes:** Human-in-the-loop: the target style was settled by example in conversation, and only real output can confirm it.

## Answer

Settled after three rounds on real output. Narration-led and "structure as skeleton, full sentences as content" both read too narrative; the cause was the prompt prescribing form. The final default fixes only the content (complete, in order, explanations, citations, omissions named) and leaves form to the model, which then uses headings, lists and tables as in any answer. The reader approved this version.
