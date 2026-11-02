# Portfolio background

The portfolio site (github.com/sarahjthorn/portfolio, cloned next to this repo
at `~/claude/portfolio`) has the brain as its live background. Version 2 lives
in `portfolio-v2/` there: a plain HTML/CSS/JS page whose canvas draws
`brain/snapshot.json`. Every star is a memory; hover one to read it, click to
open it with its links. Project cards, the "lately on my mind" chips and the
timeline rows each light up their own stars.

It's a **snapshot**, not live: re-export whenever you want the portfolio to
catch up with the brain.

## Updating it

```bash
npm run portfolio:review
```

This exports, then opens the review file. (`npm run export:portfolio` exports
without opening it.) The export writes `../portfolio/portfolio-v2/brain/snapshot.json` from the local
database. No API calls, no cost. Then read
`scripts/portfolio-snapshot.review.txt` - the exact list of what's public,
what's held back and why - and commit/push the portfolio repo yourself.

New memories are **held back** until you've reviewed them: anything dated
after `reviewedThrough` stays private and is listed under "Held for review".
Read those titles, hide any you don't want shown, then move the date on and
export again.

## What's public (`scripts/portfolio-snapshot.config.json`)

The config is yours alone (gitignored, since it names real memories). Start
by copying `scripts/portfolio-snapshot.config.example.json` to it.

| Setting | Meaning |
|---|---|
| `publicCategories` | Project, Interests, Technical, Research. A memory is public only if **every** category it has is allowed. |
| `conditionalCategories` | Categories allowed only in company. Preferences counts when the memory is also Research or Interests (tastes, not build details). Career counts when the memory matches a timeline row, so roles on the page show and job hunting doesn't. |
| `reviewedThrough` | Memories after this date are held back until reviewed (see above). |
| `hidePatterns` | Words or `/regex/` matched against title, text and keywords. A match forces the memory private (visa, salary, applying, grade, ...). |
| `hideIds` | Specific memories forced private, each with a `why`. Copy a realId from the review file. |
| (duplicates) | When memories share a title, only the newest is public; the rest are listed in the review file as worth merging in Tidy up. |
| `maskOnPrivate` | Health, Mind. Private stars keep their category colours except these, which are dropped. |
| `includeContent` | `false`: public memories show title, categories and date only, never the text. |
| `maxLinksPerNode` | Links are trimmed to each memory's strongest 8, so the page stays light. |
| `tags` | `projects` (keyed by each card's `data-project`), `timeline` (one list per row, top to bottom) and `topics` (the About chips). Matched here against every memory's full text; only the tag ids are written. |
| `outputDir` | `../portfolio/portfolio-v2/brain`. |

Everything else becomes a **private star**: no title, text, keywords or date,
just its (unmasked) categories and links. Real memory ids are replaced with
`m1`, `m2`, … in time order. Positions are worked out by the export (the same
force layout the page used to run), so nothing private ever reaches the
portfolio's files and the page doesn't have to lay out hundreds of stars.

## The old v1 embed

`src/embed/portfolio.jsx` and `vite.portfolio.config.js` built the v1
background (React + three.js, ~1.7 MB). Version 2 doesn't use them;
`npm run build:portfolio` still builds it into `../portfolio/brain` if needed.

## Previewing locally

From the portfolio folder: `python3 -m http.server 4322 --directory portfolio-v2`
and open http://localhost:4322.
