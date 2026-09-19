# DeepChart Portal: product spec

**One sentence:** a doctor portal that gathers a patient's records from every hospital that holds
them and flags any disagreement on a fact a decision relies on, **before** the decision is made.

**Pitch line:** hospitals can already share records. Nobody checks them at the moment it matters.

**Status:** built. Backend in `backend/deepchart/`, screens in `frontend/src/deepchart/` (`/doctor`, `/p/<token>`),
tests in `tests/test_deepchart.py`, routes in `CONTRACT.md` → "DeepChart portal". It sits on the board's
records gate (`backend/gate.py`) and does not change it.

---

## 1. What is new

| Today (board only) | With the portal |
|---|---|
| Each patient has two fixed sources (local intake plus "Hospital B - Cardiology") | Each hospital holds its own records. A doctor **pulls** the matching ones by lookup, or a hospital **pushes** them on transfer |
| DeepChart checks only bed moves | DeepChart also checks **orders and intake notes** a doctor writes |
| Only the incident commander sees holds | A **doctor** reviews conflicts, confirms identity, and resolves holds |
| No login | Pick a **hospital, then a role, then a demo PIN**. Patients get a **private link** |

## 2. What makes DeepChart different

Epic's Care Everywhere, the national record-sharing networks, and transfer summaries all move
records between hospitals. DeepChart does not compete with them. It reads what they move.

1. **It checks only the facts the decision depends on.** Every move and order declares its
   `because` facts, and DeepChart compares just those across all sources, not the whole chart.
2. **It runs before the action, not after.** Reconciling records today is a chore someone does
   when they have time. DeepChart runs when a move or order is made, and on the board it holds the move.
3. **It never says which record is right.** It shows every version with its source and date,
   plus the exact text `sources disagree; a human must resolve`.
4. **It tells a gap from a conflict.** If a source doesn't mention a fact, that's a *gap*. If two
   sources say different things, that's a *conflict*. Only conflicts raise warnings.
5. **It flags identity uncertainty.** "Is this even the same person?" is shown to the doctor as
   a conflict, and a weak match is never merged silently.
6. **It's measured.** We plant the conflicts ourselves and keep an answer key, so we report
   precision and recall instead of guessing.
7. **It's wired into the surge board.** A hold on a doctor's screen is the same hold that pauses
   the bed move on the command board.

### What we must never claim
- That hospitals cannot share records today. They can.
- That DeepChart checks drug interactions. It checks disagreements between records, not pharmacology.
- That DeepChart knows which record is correct.

## 3. Who uses it

| Who | Where | Logs in with | Can do |
|---|---|---|---|
| Incident commander | `/board` | Hospital, `commander` role, PIN | Everything on the board today: approve escalations, resolve holds |
| Doctor | `/doctor` | Hospital, `doctor` role, PIN | Look up patients, confirm identity, view the merged chart, write orders, acknowledge warnings, resolve holds, send transfers |
| Patient | `/p/<token>` | Nothing. The unguessable link *is* the access | See their own plain-language status and who viewed their record |

Demo hospitals:
- **Emer Flow General** runs the board, where the surge happens. Its records are the `Local intake` source.
- **Hospital B** holds the `Hospital B - Cardiology` records and sends patients by transfer.
- **Hospital C** only holds old primary-care records, including a lookalike for every patient with a planted conflict.

## 4. Screens

### 4.1 Login (one for the whole app, built as `frontend/src/auth/`)
The role picks the screen: Commander → board (`/`), Doctor → DeepChart (`/doctor`). A doctor at Emer Flow General can also view the board.
```
+---------------------------------------------+
|  Emer Flow                                  |
|  Hospital   [ Emer Flow General   v ]        |
|  Role       ( ) Commander  (•) Doctor       |
|  PIN        [ ****  ]        [ Enter ]      |
|  Demo only. A real deployment uses the      |
|  hospital's own single sign-on (SSO).       |
+---------------------------------------------+
```

### 4.2 Patient search and match review (`/doctor`)
```
+---------------------------------------------------------------+
|  Search: [ Lena Cho ]  DOB [ 1972-03-02 ]  Sex [F]  [ Search ]|
|  Reason for access: [ Treating in the ER        v ]  (needed) |
+---------------------------------------------------------------+
|  Hospital B   Lena Cho  1972-03-02 F  phone ..4471  STRONG    |
|                                         [ Same person ] [ No ]|
|  Hospital C   Lena Cho  1972-03-02 F  phone ..9020  POSSIBLE  |
|     differs: phone, address                                   |
|     DEEPCHART: is this the same person? a human must decide   |
|                                         [ Same person ] [ No ]|
+---------------------------------------------------------------+
```
- **STRONG** means name, date of birth, and sex agree, plus at least one more identifier (phone, insurance ID, or address).
- **POSSIBLE** means name, date of birth, and sex agree but nothing else does. It is shown as an identity conflict.
- **No match merges without a click.** Even strong matches need the doctor to confirm them.
- **As built:** the screen shows a patient list (held and conflicting patients first) and a **Look up other hospitals** button
  that searches with that patient's identity. Free-text search by name, date of birth and sex exists in the API
  (`/api/lookup?name=&dob=&sex=`) but has no screen yet.

### 4.3 Merged chart (`/doctor`, after confirming)
```
+---------------------------------------------------------------+
|  Lena Cho · 54 F · MC-03 · in ER · HELD for ICU              |
+---------------------------------------------------------------+
|  anticoagulant                              ⚠ CONFLICT        |
|    Hospital B - Cardiology (2026-03-02)  warfarin 5mg  ACTIVE |
|    Local intake            (2026-09-19)  none recorded ABSENT |
|    sources disagree; a human must resolve                     |
|  penicillin_allergy                         ✓ agree           |
|    Hospital B - Cardiology (2026-03-02)  Penicillin G PRESENT |
|    Local intake            (2026-09-19)  Penicillin G PRESENT |
|  blood_type                                 · gap             |
|    Local intake (2026-09-19) O+  · Hospital B: not mentioned  |
+---------------------------------------------------------------+
|  New order: [ start heparin drip                     ]        |
|  Relies on: [x] anticoagulant  [ ] vitals_stable  ...         |
|                                              [ Check order ]  |
+---------------------------------------------------------------+
```
- Every value can be clicked to show its `resource_id`, so every value's origin can be traced.
- Conflicts are listed first, then facts where the sources agree, then gaps.

### 4.4 Order warning
```
+---------------------------------------------------------------+
|  ⚠ VERIFICATION REQUIRED                                      |
|  This order relies on "anticoagulant". The records disagree:  |
|    Hospital B - Cardiology (2026-03-02)  warfarin 5mg  ACTIVE |
|    Local intake            (2026-09-19)  none recorded        |
|  sources disagree; a human must resolve                       |
|  Reason: [ called Hospital B, warfarin stopped in June   ]    |
|                                         [ I have reviewed ]   |
+---------------------------------------------------------------+
```
It doesn't block the order and it isn't a recommendation. The order can only be saved after the doctor gives a reason.

### 4.5 Transfer inbox (`/doctor`)
```
+---------------------------------------------------------------+
|  Incoming transfers to Emer Flow General                      |
|  TR-01 Lena Cho   from Hospital B   09:14   1 conflict  [Open]|
|  TR-02 Omar Diaz  from Hospital B   09:20   clear       [Open]|
+---------------------------------------------------------------+
```

### 4.6 Patient link (`/p/<token>`)
```
+---------------------------------------------+
|  Hi Lena.                                   |
|  You are waiting for a bed.                 |
|  Staff are double-checking your records.    |
|                                             |
|  Who looked at your record                  |
|   09:16  Emer Flow General · doctor         |
|                 reason: Treating in the ER  |
+---------------------------------------------+
```
It never shows conflict details, clinical values, or anyone else.

## 5. Flows

**(a) Pull lookup**
1. The doctor picks a reason for access, then searches by name, date of birth, and sex.
2. The backend asks every other demo hospital for matches, and each one comes back tagged STRONG or POSSIBLE.
3. The doctor confirms or rejects each match, and each choice goes into the access log.
4. Confirmed records become extra sources on the patient, and the merged chart opens.

**(b) Push transfer**
1. A doctor at Hospital B clicks **Transfer to Emer Flow General**.
2. A's record for that patient is linked as a source on B's patient, and it shows up in B's inbox.
3. Opening it goes straight to the merged chart, with no match review because the transfer names the patient.

**(c) Order check**
1. The doctor writes an order and ticks the facts it relies on. These are the same facts as in `because`.
2. The backend runs `gate.check(patient, because, patient.unit)`, ignores `blocking`, and returns the conflicts as warnings.
3. If the warning list is empty, the order is saved. Otherwise the doctor must acknowledge with a reason.

**(d) Resolving a board hold**
1. A hold created on the command board also appears on the doctor's merged chart.
2. The doctor picks **Proceed** or **Cancel**, using the same `POST /api/holds/{id}/resolve` as the board.
3. The board updates live through the existing event stream.

## 6. Identity matching rules
- Large hospital systems carry duplicate patient records at rates between **8 and 16 percent**
  (`docs/archive/concord/notebooklm-two-ideas.md`, Part B). Matching by name is where this feature can do harm.
- **STRONG** means name, date of birth, and sex are equal after normalizing (case, whitespace, accents)
  **and** at least one of phone last four digits, insurance ID, or address is equal.
- **POSSIBLE** means name, date of birth, and sex are equal, but nothing else is.
- Anything less is **not shown**.
- **Nothing merges automatically.** The doctor clicks every link, and every click goes into the log.
- A rejected match is remembered for this session so it doesn't come back.

## 7. Access and privacy
- **Demo login** is hospital, then role, then a PIN. That gives a session token, sent in the `X-Session` header.
  A real deployment would use the hospital's own SSO.
- **Reason before access (break-the-glass):** no outside record opens until the doctor picks
  a reason. The choices are `Treating in the ER`, `Admitting`, `Transfer received`, and `Consult`.
- **Access log:** every lookup, match decision, and chart open is saved as who, which hospital, which patient, when, and why.
  The patient can see it on their link.
- **Scope:** a doctor only sees patients at their own hospital, plus the outside records they looked up
  or received for those patients.
- **Data:** synthetic patients only. Under HIPAA, sharing records between hospitals for
  treatment is generally permitted. A real product would also need patient consent handling, business associate agreements (BAAs),
  and a real record-exchange network. None of that is built here.

## 8. Safety boundary (not negotiable)
- The UI uses exactly `VERIFICATION REQUIRED` and `sources disagree; a human must resolve`.
- It never shows which version is correct, never suggests a dose, and never tells a doctor to do or not do something.
- **Order warnings are non-blocking.** They need an acknowledgement with a reason, not a refusal.
- **Board holds stay as they are.** Moves into non-emergency units hold, and life-saving placements go ahead
  with a records flag (`rules.EMERGENCY_UNITS`).
- The patient view never shows conflicts.

## 9. Out of scope
- Real record-exchange networks (TEFCA, Carequality, CommonWell) and live FHIR endpoints
- Drug-interaction or dosing databases
- Real authentication, passwords, or accounts
- Saving anything across restarts (state lives in memory, like the board)
- Free-text understanding of orders. The doctor ticks the facts an order relies on

## 10. Success measures
- **Precision and recall** of conflicts found against the answer key, now including
  **identity conflicts**: one planted lookalike patient per scenario.
- **Time to first conflict:** from pressing search to the first conflict on screen. Target: under 3 seconds in stub mode.
- **Zero safety-copy violations:** a test greps every response for words that give instructions.
