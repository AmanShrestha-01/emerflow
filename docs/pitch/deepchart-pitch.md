# DeepChart: pitch and judge Q&A

## The line
> Hospitals can already share records. Nobody checks them at the moment it matters.
> DeepChart checks only the facts a decision relies on, across every hospital's record,
> before the patient moves, and hands the disagreement to a human instead of guessing.

## Who's who (all fictional)
| Hospital | Role in the demo | Demo doctors (picked at login) |
|---|---|---|
| **Johns Hopkins Hospital** | Runs the command board; the surge happens here. Its record is "Local intake" | Dr. Amara Whitfield, Dr. Daniel Osei, Dr. Rebecca Lindqvist |
| **Fells Point Heart Institute** | Holds an older cardiology record for each patient; can transfer 3 of its own patients | Dr. Samuel Achebe, Dr. Hannah Morales, Dr. Marcus Delaney |
| **Hampden Family Health** | Holds old primary-care records, plus a lookalike (same name and birthday, different person) for every patient with a planted conflict | Dr. Claire Donovan, Dr. Julian Ashby, Dr. Naomi Fairbanks |

Johns Hopkins Hospital is real (this hackathon's host). The two outside hospitals and all the doctors are made up: we checked on 2026-09-19 that no hospital uses those names. The patients are generated too, and no doctor shares a first or last name with a patient.

## 60-second demo script

**Before you start:** run the backend with `EMERFLOW_RECORDS_CHECK=1` (holds only happen with the records check on) and build the site.
Log in at `/login` → Johns Hopkins Hospital → **Hospital** → PIN `demo` (the command board).
Have a phone (or a narrow window) ready for the patient link.

Screenshots of every step, from a real run: `docs/screenshots/deepchart/` (re-record with `tools/record_deepchart_demo.cjs`).
Which patient gets held depends on timing, so names and facts on screen will differ from the screenshots.

| # | On screen | Say | Screenshot |
|---|---|---|---|
| 1 | Board: press **Bus crash**. A card appears under **Big decisions for you**: **VERIFICATION REQUIRED**, "*name* can't be moved to … yet: two hospitals' records disagree about …" | "A bus crash. 25 patients head to Johns Hopkins. The swarm wants to move this patient, and DeepChart paused it: the move relies on a fact two hospitals' records disagree about." | `01-board-hold-card` |
| 2 | Board: **Check records in DeepChart** (open it in a new tab to keep the board on screen) → DeepChart asks for a doctor login, with Doctor preselected. Pick **Dr. Amara Whitfield**, PIN `demo` | "The ER doctor signs in as herself. Every action from now on carries her name." | `02-login-doctor` |
| 3 | DeepChart opens on that patient, reason preset to *Treating in the ER*, with the same hold in amber | "Same hold as the board, with every source side by side." | `03-doctor-chart-hold` |
| 4 | **Look up other hospitals** → Fells Point Heart Institute **Strong match**, Hampden Family Health **Possible match** | "Hampden has the same name and birthday, but a different phone, insurance ID and address. We don't merge that. The doctor decides." Click **Not this patient** on the possible match. | `04-lookup-matches` |
| 5 | Merged chart: the amber **Records disagree** fact | "We don't say which record is right. We show both, with dates and sources." Click a value to show its record ID. | `05-merged-chart` |
| 6 | **Add to the record**: pick the disputed fact and what the patient told her (e.g. Blood thinners → Taking it now → warfarin 5mg) → **Add entry** | "Her finding is saved as one more source, the doctor's entry. It doesn't overwrite anyone. The records still disagree, so it still says so." | `06-add-to-record` |
| 7 | **New order**: type it, tick the same fact → **Check order** → **VERIFICATION REQUIRED**; type what she checked → **I have reviewed** | "The order relies on the disputed fact, so it's flagged. It isn't blocked and it doesn't tell her what to do. Her reason is logged." | `07-order-verification` |
| 8 | On the hold: **Records checked: move** → "Move released" | "A human resolved it." The board's card disappears and the patient moves. | `08-hold-released` |
| 9 | **Who opened this record**: every step with Dr. Whitfield's name and reason | "Every look is logged, by name." | `09-access-log` |
| 10 | **Make a private link for the patient** → open it on the phone → it asks for the date of birth (shown on the chart as "Born …") | "The link alone shows nothing. The patient confirms their birthday." | `10-patient-dob` |
| 11 | Patient page: status, which hospitals' records are in use, and who opened the record | "The patient sees who looked and why, never the clinical details." | `11-patient-page` |

**Optional: the transfer.** In another tab log in at **Fells Point Heart Institute** → Doctor → **Dr. Samuel Achebe** and press
**Transfer to Johns Hopkins Hospital** (`12-transfer-desk`). The patient appears under *Incoming transfers* in Dr. Whitfield's
DeepChart with one conflict already flagged (`13-incoming-transfer`), and arrives on the board 8 minutes later.

**Close:** "We planted every conflict ourselves and kept an answer key. After a 25-patient surge, DeepChart flagged
11 of 11 record conflicts with no false alarms, and showed all 11 lookalike patients as 'possible', never 'strong'."
These numbers come from `GET /api/deepchart/score` (seed 7, one surge; re-checked 2026-09-19 after the rename). **Say the honest part too:**
the check is plain code run against conflicts we planted, so 100% shows it works as designed. It isn't a claim about real-world records.

## Judge questions

**"Epic already does this."**
Epic's Care Everywhere and the national networks *move* records, and Epic has a screen for merging outside
medication lists into your own. They don't check the records at the moment of a decision against the specific facts that decision
depends on, and they don't pause a bed move in a surge. We sit on top of record sharing. We don't replace it.

**"Isn't this a medical device?"**
We designed it not to be. It shows every source and says "sources disagree; a human must resolve". It never names a correct value,
never suggests a dose or an action, and its warnings don't block. Our research (`docs/deepchart/legal.md`) points to it being
non-device software (an electronic patient record display, with the clinical decision support exemption as a backstop). We haven't asked FDA,
so say "designed to stay outside device rules", not "FDA-cleared" or "FDA-exempt".

**"What about privacy?"**
All patients, doctors and hospitals are fictional. In the product, a doctor must pick a reason
before any outside record opens (break-the-glass), every lookup is logged, and the patient can see that log after confirming their
date of birth. HIPAA already allows providers to share records for treatment without a separate authorization. A real deployment would
need business associate agreements, access through Maryland's state exchange (CRISP) or a national network, MHCC registration, and handling for
opt-outs and specially protected records (substance use, reproductive care). Details and sources: `docs/deepchart/legal.md`.

**"How do you know it works?"**
We plant known conflicts (existence, status, value) and a lookalike patient, and we write an answer key.
We report precision and recall for each kind. In stub mode it's deterministic code, so the numbers can be reproduced.

**"What happens with a wrong patient match?"**
Hospitals have 8 to 16 percent duplicate records, so we never merge automatically. A possible match
shows up as its own conflict ("same person?"), and linking needs a click that goes in the log.

**"Why not just use an AI to read the whole chart?"**
AI is used on the board, where the department agents talk things through. The records check is plain code on purpose.
It compares declared facts across sources, so it's reproducible, measurable, and it can't make up a conflict.

**"Does it check drug interactions?"**
No. Existing record systems already do that with licensed drug databases. DeepChart catches places where the *records
disagree with each other*, which those systems don't catch.

## Words to avoid on stage
- "DeepChart knows / decides / recommends"
- "The correct record is…"
- "Prevents medical errors" (say "surfaces disagreements before a decision")
- "Real patient data"
