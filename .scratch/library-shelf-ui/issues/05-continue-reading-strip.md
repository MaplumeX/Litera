# 05: Continue reading as a compact resume strip

**What to build:** See spec "Continue reading is a resume strip".

**Status:** resolved

- [x] `takeRecent` skips Books whose Reading status is `finished`
- [x] Strip hidden while searching, in select mode, and when sort is `recent` + `desc`
- [x] Compact tile: small cover, title, author, progress bar + percent; same context menu as the shelf; click opens
- [x] Same tile in grid and list views
- [x] Tests: `takeRecent` finished case; strip visibility rules; tile opens the book

## Comments

- `BookResumeTile` in `BookCard.tsx` carries the context menu but no ⋯ button, to stay compact; the same Book's card on the shelf below has the ⋯.
- Because the default sort is Recently opened / newest first, a fresh install does not show the strip until the reader changes sort or direction. That is intentional: under that sort the shelf's first row is the same books.
- The main shelf container carries `data-shelf="main"` so tests can find it regardless of whether the strip renders.
- `BookCoverImage` gained `small`, which scales the initial-letter fallback down; the list row's 40px thumbnail was rendering a 4xl initial (its old `className` only reached the `<img>`).
