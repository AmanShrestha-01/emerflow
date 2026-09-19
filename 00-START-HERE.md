# Concord — everything in one place

HopHacks 2026 · Johns Hopkins · Sept 18–20 · team of 2

**The project in one sentence:** a hospital command board that will not move a
patient when the records behind that decision disagree with each other.

**The pitch line:** we don't flag every contradiction — we flag the ones that are
about to change where a patient goes.

---

## Read in this order

| File | What it is | Read it when |
|---|---|---|
| `01-PRD.md` | Build spec: stack, two-person split, timeline, cut order | First. This is the working document. |
| `02-implementation-plan.md` | 14 tasks with actual test + implementation code | While building, one task at a time |
| `03-design-spec.md` | Why the design is what it is; safety boundary; policy framing | Before talking to judges |
| `04-notebooklm-concord.md` | Plain-language explainer of the merged project | Upload to NotebookLM for an audio overview |
| `05-…-questions.md` | Questions to ask NotebookLM about it | With the above |
| `06-notebooklm-two-ideas.md` | Deep explainer of both original ideas separately | To understand the reasoning behind the merge |
| `07-…-questions.md` | Questions to ask about those | With the above |
| `08-visual-explainer.html` | Visual walkthrough for non-technical people | Open in a browser; show it to anyone |
| `09-deepchart-portal-spec.md` | DeepChart doctor portal: cross-hospital lookup, merged chart, order warnings, login | Before building the portal |
| `10-deepchart-implementation-plan.md` | Portal build tasks with tests first, split, and cut order | While building the portal |
| `11-deepchart-pitch.md` | Demo script and judge Q&A for DeepChart | Before judging |

## Online versions

- **Shared PRD** (teammate can edit and comment): https://claude.ai/code/artifact/c21a808d-8e78-4062-97bf-091eed9b100c
- **Visual explainer** (shareable page): https://claude.ai/artifact/PjFjVg1zH6ZCiE19B5Mrcd

Both are private until shared from the page's share menu.

---

## Before the clock starts

1. Download the pre-built Synthea 1K FHIR R4 sample from synthea.mitre.org/downloads
   into `data/synthea/`. **Do not run the generator** — it takes over four hours.
2. Open one bundle and read it by hand. Judges will ask to see one.
3. Agree the JSON contract (PRD, "The contract between us") with your teammate on paper.
4. Create Gemini and Vite accounts/keys.

**Hackathon rule:** the first commit must be after kickoff. Downloading data is fine;
writing code is not.

## The three things that can never be cut

1. The conflict injector
2. The answer key and the accuracy score it enables
3. Clickable provenance on every conflict

Those three are the project. Everything else is presentation.

## The line to never cross

Concord never says which record is right. It says the sources disagree and a human
must resolve it. The moment software gives a single clinical instruction in an urgent
situation, it is a regulated medical device.
