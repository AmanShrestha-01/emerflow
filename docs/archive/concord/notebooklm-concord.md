# Concord: A Hospital Board That Stops Bad Decisions Made From Bad Records

This document explains a student hackathon project in plain words. No prior
medical or programming knowledge is needed.

---

## Part 1: The two problems

### Problem one: hospital records disagree with each other

When you go to a doctor, that office keeps a file on you. When you go to a
different hospital, it keeps its own separate file. So does urgent care. So
does your pharmacy. Nobody ever merges these files into one.

Over years, you end up with several files about you that do not match.

Real examples of what this looks like:

- One file says you are allergic to penicillin. Another file says you have no
  allergies at all.
- One file says you take 10mg of a medicine. Another says 20mg.
- One file says you were diagnosed with diabetes. Another says diabetes was
  tested for and ruled out.

There is a specific reason this keeps happening. When doctors write notes, they
often copy the previous note and edit it. Studies have found that about half of
all the writing in a hospital's computer system is copied from an earlier note.
So an old fact gets copied forward again and again, and on screen it looks just
as current as something written today. A medicine you stopped taking two years
ago can still appear as "active."

### Problem two: when a hospital is overloaded, nobody has time to check

Hospitals constantly decide where patients go. Who gets the last intensive care
bed. Who can be moved to a lower level of care to free that bed up. Who waits.

When things are calm, a nurse or doctor has time to notice that a record looks
odd and go check it.

When twenty-five patients arrive at once - a bus crash, a building collapse, a
bad night - nobody has that time. Decisions get made in seconds, using whatever
the computer screen says.

### The two problems together are the real danger

Put them side by side and you get the failure that actually hurts people:

**A decision about where a patient goes that was completely logical, made from
information that was wrong.**

Nobody was careless. The nurse read the screen and made the right call for what
the screen said. The screen was out of date. And because the hospital was
overloaded, nobody had time to catch it.

---

## Part 2: What Concord is

Concord is a screen a hospital would use during a busy period. It looks like a
command board. It shows how full each part of the hospital is, it shows patients
arriving, and it shows where each patient is being sent.

It does one unusual thing.

Every time the system decides where to send a patient, it has to say out loud
**which facts it based that decision on.** Then, before the patient actually
moves, Concord goes and checks *only those facts* against every file that exists
on that patient.

If the files disagree about one of those facts, the patient does not move. The
row on screen turns amber and says HELD. It shows both versions of the fact,
where each one came from, and the date of each. And it waits for a human being
to decide.

### The one sentence that describes the whole project

**"We don't flag every contradiction. We flag the ones that are about to change
where a patient goes."**

This distinction is the heart of the idea. A patient's files might disagree in
forty places. Most of those disagreements do not matter this minute. A small
mismatch in the dose of a blood pressure pill is a paperwork problem for someone
to clean up later.

But the same kind of mismatch about a blood thinner, for a patient who is about
to go to surgery, is an emergency. It is the difference between a routine
operation and dangerous bleeding.

Other tools in this area try to find every disagreement in a patient's history.
That produces a long list that a busy nurse will never read. Concord only shows
the handful that are about to change a decision being made right now.

### The safety rule Concord never breaks

Concord never says which version of a fact is correct. It never says "give 20mg"
and it never says "do not send this patient to that unit."

All it ever says is: **"These two records disagree. Here is each one and where it
came from. A person needs to resolve this before the patient moves."**

This matters for two reasons. First, it is honest - the software genuinely does
not know which record is right. Second, it keeps the project on the safe side of
medical regulation. Software that tells a doctor what to do in an urgent
situation is treated as a medical device and needs government approval. Software
that points out that two documents disagree and asks a human to look is not.

---

## Part 3: How it works, step by step

Here is what happens from beginning to end.

**Getting the data ready (before the demo)**

There is a free tool called Synthea, made by a research organization, that
generates fake patients with realistic medical histories. Nobody's privacy is
involved - these people do not exist. The project uses twenty of them.

Each fake patient's history is then split into two or three separate files, to
imitate real life: one file from "our hospital," one from an "outside hospital,"
one from a "pharmacy."

**The important catch:** Synthea's fake patients have tidy records that all agree
with each other. Real patients don't. So the project includes a script that
deliberately goes in and breaks things - changes a dose in one copy, deletes an
allergy from another, makes one copy three weeks older than it looks.

Crucially, that script **writes down everything it broke** in a separate list.
That list is the answer key, and it is what lets the team measure whether the
system actually works. At the end they can say: we hid fifty problems in this
data, and the system found forty-six of them.

**Step 1.** A judge presses a big red button labeled MASS CASUALTY. Twenty-five
new patients arrive at once.

**Step 2.** Each part of the hospital reports its own situation in plain
language. Intensive care says "I am full, critical patients only." The
step-down unit says "I have three beds open, I can take stable patients."
Staffing says "A nurse is free now."

**Step 3.** For one patient - call him P-14, sixty-eight years old, fainted at
home - the system picks a destination: the step-down unit.

**Step 4.** And it records *why*: "step-down, because this patient is not on a
blood thinner, because vital signs are stable, because he does not need
intensive care."

**Step 5.** Concord now looks only at those three facts, in every file that
exists on P-14. It is not reading the whole history. Just three things.

It finds a disagreement:
- Our hospital's file, written today: no blood thinners listed.
- The outside hospital's file, written three weeks ago: warfarin, 5mg, active.

**Step 6.** Artificial intelligence does the judging here, and this is where it
is genuinely needed. Two questions get asked. First: what exactly does each file
claim? Second: is this a real contradiction, or just two different ways of
writing the same thing?

This cannot be done with simple rules. "Coumadin 5mg daily," "warfarin 5 mg,"
and "on anticoagulation" are the same fact written three ways, and no list of
rules can reliably tell that apart from a genuine difference.

**Step 7.** P-14's row turns amber. HELD. He does not move. The screen shows
both records, their sources, and their dates. It asks a person to resolve it.

**Step 8.** Everyone else flows through normally. Patient P-15's facts agree
across all her files, so her row goes green, she is placed, and a bed count drops
by one. Out of twenty-five patients, maybe three get stopped. That is the whole
point - a short list worth reading, not a long list nobody reads.

**Step 9.** At the end, the system compares what it caught against the answer key
and reports a score.

---

## Part 4: How this project came to be

It started as two separate project ideas.

**The first idea** was a simulated hospital where small AI programs represented
each department - emergency, intensive care, staffing, surgery - and argued with
each other over limited beds during an emergency. It had a great demonstration:
press a button, watch the hospital get overwhelmed, watch it reorganize.

Its weakness was that the AI was not really doing anything important. The actual
decisions came from ordinary rules and mathematics. The AI just explained the
results in nice sentences. Anyone technical would ask: why do you need AI here
at all?

**The second idea** was a system that reads a patient's files from many different
places and finds the contradictions between them.

Its weakness was the opposite. The idea was solid and the AI was genuinely
necessary, but the demonstration was dull - a list of paperwork problems. And
pointing out a problem is not the same as doing something about it.

**Merging them fixes both weaknesses at once.**

The busy hospital creates a real decision, and time pressure, and a button that
makes a demonstration exciting. The record-checking gives the AI something only
AI can do, and turns a flagged contradiction into a real consequence: a patient
stops moving until a human looks.

They are not two features sitting next to each other. One creates the decision,
the other checks the ground that decision is standing on.

---

## Part 5: What gets built, and what deliberately does not

The team is two people with thirty-six hours. Deciding what *not* to build
matters as much as deciding what to build.

**What gets built:**

1. A script that turns each fake patient into two or three separate source files
2. A script that plants known problems in them and writes the answer key
3. A queue of arriving patients, plus the red surge button
4. A simple function that picks a destination and records its reasons
5. The checker: two AI calls, one to extract what each source claims and one to
   judge whether they truly contradict
6. One web page: capacity bars at the top, patient rows in the middle, and the
   conflict detail at the bottom
7. A score screen comparing results against the answer key

**What deliberately does not get built, and why:**

- **A real simulation engine.** A simple list of patients and a timer produces
  exactly the same thing on screen. The heavy tool fights with the web server
  and would eat an entire night.
- **A mathematical optimizer.** A simple "first open bed that fits" rule is
  twenty lines of code. When someone asks why there is no optimizer, the answer
  is good: making a decision faster from wrong information is not the problem
  being solved.
- **A database.** Everything is held in the computer's memory. Nobody looking at
  the screen can tell the difference.

The general principle: keep everything the audience can see, remove everything
they cannot.

---

## Part 6: Why this could win

The event is HopHacks at Johns Hopkins University, September 18-20, 2026.
Projects are judged equally on four things: polish, usefulness, creativity, and
technical difficulty. Judging works like a science fair - around a hundred
projects, judges walking from table to table, roughly ninety seconds each.

**It gets attention in ninety seconds.** A judge physically presses a button and
watches a hospital become overwhelmed. That is more memorable than describing
something.

**It has a real number.** Because the team planted the problems themselves and
kept the answer key, they can say "we caught forty-six out of fifty." Almost no
hackathon project can state a measured result. Most just say "it works."

**It cannot be faked.** A judge can click any flagged conflict and see the
original source documents. Either the links work or they do not.

**It answers the hardest question.** When a judge asks why AI is needed, there is
a real answer: deciding whether two differently-worded medical records
contradict each other is not something rules or mathematics can do.

**The timing is real.** Between January 2025 and February 2026, the amount of
medical record sharing between American health systems grew from about ten
million records to nearly five hundred million. Files are being merged at
enormous scale right now, and nothing in that system checks whether the merged
files agree with each other. Separately, US regulation already requires hospital
software to *offer* a way to reconcile medication and allergy lists - but
requires nothing that actually *finds* the disagreements. That gap is exactly
where this project sits.

---

## Part 7: The honest weaknesses

**The problems in the data were planted by the team.** This sounds like cheating
until you consider the alternative: with real disagreements you would have no way
to know whether the system found all of them, so you could not report a score at
all. The right approach is to say so first, before anyone asks. Volunteered, it
sounds like careful method. Discovered, it sounds like hiding something.

**Thirty-six hours and two people is very little.** The plan has a defined order
for cutting features when time runs short. Three things can never be cut: the
script that plants the problems, the answer key, and the clickable source
documents. Those three are the project; everything else is decoration.

**It has not been tested on real medical records**, which are far messier than
generated ones - misspellings, missing fields, local codes no outsider can read.
That is honest future work, not something solvable in a weekend.

---

## Glossary

**Concord** - the project's name. In medicine, "concordance" means records
agreeing with each other.

**Synthea** - a free tool that generates realistic but completely fake patient
records for research and testing.

**Provenance** - knowing exactly where a piece of information came from: which
file, which organization, what date.

**Answer key / ground truth** - the written list of problems the team planted, so
results can be measured rather than guessed at.

**Held** - the state of a patient whose placement has been paused because the
records behind that placement disagree. The opposite is committed.

**Clinical decision support** - software that helps a clinician decide what to
do. When it gives a single instruction in an urgent situation, regulators may
treat it as a medical device. This is why Concord only ever reports that sources
disagree.
