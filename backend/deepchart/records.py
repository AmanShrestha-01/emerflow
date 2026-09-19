"""Who holds which records. Additive over the board's scenario: nothing here changes `Patient.sources`
until a human links a record.

- HOME (the board hospital) holds each patient's "Local intake" source.
- Fells Point Heart Institute holds the "Fells Point Heart - Cardiology" source the scenario already attached, plus a small
  roster of its own patients who can be transferred to HOME.
- Hampden Family Health (primary care) holds a real matching record for some patients and a LOOKALIKE (same
  name, date of birth and sex, different person) for every patient with a planted conflict.

Identity details (dob, sex, phone, insurance, address) live here, derived deterministically from the pid,
so the board's models and scenarios stay untouched.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import random
from dataclasses import dataclass

from backend.sim.models import Claim, Patient, SourceRecord
from backend.sim.scenarios import FIRST, LAST, TODAY, give_records

HOME = "Johns Hopkins Hospital"
HOSP_B = "Fells Point Heart Institute"
HOSP_C = "Hampden Family Health"
HOSPITALS = (HOME, HOSP_B, HOSP_C)
STREETS = ["Charles St", "Greenmount Ave", "Eastern Ave", "Light St", "Cathedral St", "Pratt St",
           "Boston St", "Falls Rd", "York Rd", "Harford Rd"]


def _rng(*parts) -> random.Random:
    digest = hashlib.sha256(":".join(map(str, parts)).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


@dataclass
class Identity:
    name: str
    dob: str
    sex: str
    phone4: str
    insurance_id: str
    address: str


@dataclass
class HeldRecord:
    ref: str                # "<hospital>/<id>", stable across calls
    hospital: str
    identity: Identity
    source: SourceRecord
    pid: str | None = None  # the board patient this record truly belongs to (None for a lookalike)
    lookalike_of: str | None = None


def identity_for(p: Patient, seed: int) -> Identity:
    r = _rng(seed, p.pid, "id")
    born = _dt.date(TODAY.year - p.age, r.randint(1, 12), r.randint(1, 28))
    return Identity(p.name, born.isoformat(), r.choice("FM"), f"{r.randint(0, 9999):04d}",
                    f"INS-{r.randint(100000, 999999)}", f"{r.randint(1, 4999)} {r.choice(STREETS)}")


def _other(ident: Identity, r: random.Random) -> Identity:
    """Same name, date of birth and sex; nothing else in common."""
    phone = f"{(int(ident.phone4) + r.randint(1, 9998)) % 10000:04d}"
    street = r.choice([s for s in STREETS if s not in ident.address])
    return Identity(ident.name, ident.dob, ident.sex, phone, f"INS-{r.randint(100000, 999999)}",
                    f"{r.randint(1, 4999)} {street}")


def _copy_claims(src: SourceRecord, tag: str) -> dict[str, Claim]:
    return {f: Claim(c.fact, c.value, c.status, c.resource_id.replace("/loc-", f"/{tag}-"))
            for f, c in src.claims.items()}


def _flip(c: Claim, rid: str) -> Claim:
    if c.fact == "blood_type":
        return Claim(c.fact, "B+" if c.value != "B+" else "A-", "present", rid)
    if c.fact == "anticoagulant":
        return Claim(c.fact, "none recorded", "absent", rid) if c.status != "absent" else \
            Claim(c.fact, "apixaban 5mg", "active", rid)
    if c.fact == "penicillin_allergy":
        return Claim(c.fact, "no known allergies", "absent", rid) if c.status != "absent" else \
            Claim(c.fact, "Penicillin G", "present", rid)
    return Claim(c.fact, c.value, c.status, rid)


class Registry:
    """Built fresh on every hospital reset. Records are generated lazily and cached, so refs are stable."""

    def __init__(self, patients: dict[str, Patient], key: list[dict], seed: int) -> None:
        self.patients = patients
        self.key = key
        self.seed = seed
        self._ident: dict[str, Identity] = {}
        self._c: dict[str, list[HeldRecord]] = {}
        self.by_ref: dict[str, HeldRecord] = {}
        self.roster: dict[str, tuple[Patient, Identity]] = {}
        self._build_roster()

    # ---------- identities ----------
    def identity(self, pid: str) -> Identity:
        if pid not in self._ident:
            if pid in self.roster:
                self._ident[pid] = self.roster[pid][1]
            else:
                self._ident[pid] = identity_for(self.patients[pid], self.seed)
        return self._ident[pid]

    def set_identity(self, pid: str, ident: Identity) -> None:
        self._ident[pid] = ident

    # ---------- Fells Point Heart Institute's own patients (transfer demo) ----------
    def _build_roster(self) -> None:
        r = _rng(self.seed, "roster")
        for i, (sev, complaint) in enumerate([(2, "chest pain, on anticoagulation"),
                                              (3, "post-op fever"), (3, "atrial fibrillation")], start=1):
            p = Patient(pid=f"HB-{i:02d}", name=f"{r.choice(FIRST)} {r.choice(LAST)}", age=r.randint(35, 85),
                        complaint=complaint, severity=sev, arrived_at=0, state="placed", unit="WARD")
            give_records(p, r)
            self.roster[p.pid] = (p, identity_for(p, self.seed))

    # ---------- what each hospital holds ----------
    def records(self, hospital: str) -> list[HeldRecord]:
        out: list[HeldRecord] = []
        if hospital == HOME:
            for p in self.patients.values():
                if p.sources:
                    out.append(self._remember(HeldRecord(f"{HOME}/{p.pid}", HOME, self.identity(p.pid),
                                                         p.sources[0], pid=p.pid)))
        elif hospital == HOSP_B:
            for p in self.patients.values():
                src = next((s for s in p.sources if s.source_id == "hospital_b"), None)
                if src:
                    out.append(self._remember(HeldRecord(f"{HOSP_B}/{p.pid}", HOSP_B, self.identity(p.pid),
                                                         src, pid=p.pid)))
        elif hospital == HOSP_C:
            for pid in list(self.patients):
                out.extend(self._c_records(pid))
        return out

    def _remember(self, rec: HeldRecord) -> HeldRecord:
        self.by_ref.setdefault(rec.ref, rec)
        return self.by_ref[rec.ref]

    def planted(self) -> set[str]:
        return {k["pid"] for k in self.key if "fact" in k}

    def has_lookalike(self, pid: str) -> bool:
        return pid in self.planted()

    def _c_records(self, pid: str) -> list[HeldRecord]:
        p = self.patients[pid]
        if not p.sources:
            return []
        want_true = _rng(self.seed, pid, "c").random() < 0.34
        want_look = self.has_lookalike(pid)
        have = self._c.setdefault(pid, [])
        kinds = {("look" if r.lookalike_of else "true") for r in have}
        local = p.sources[0]
        if want_true and "true" not in kinds:
            r = _rng(self.seed, pid, "c-true")
            days = r.randint(400, 1500)
            src = SourceRecord("hospital_c", "Hampden Family Health - Primary care",
                               (TODAY - _dt.timedelta(days=days)).isoformat(), _copy_claims(local, "hc"))
            for fact in ("on_pressors", "icu_need", "vitals_stable"):
                src.claims.pop(fact, None)  # a years-old primary-care chart doesn't mention acute facts: gaps
            have.append(self._remember(HeldRecord(f"{HOSP_C}/pc-{pid}", HOSP_C, self.identity(pid), src, pid=pid)))
        if want_look and "look" not in kinds:
            r = _rng(self.seed, pid, "c-look")
            src = SourceRecord("hospital_c", "Hampden Family Health - Primary care",
                               (TODAY - _dt.timedelta(days=r.randint(60, 900))).isoformat(), {})
            for f, c in local.claims.items():
                rid = c.resource_id.replace("/loc-", "/hcx-")
                if f in ("anticoagulant", "penicillin_allergy", "blood_type"):
                    src.claims[f] = _flip(c, rid)
            have.append(self._remember(HeldRecord(f"{HOSP_C}/pcx-{pid}", HOSP_C, _other(self.identity(pid), r),
                                                  src, lookalike_of=pid)))
        return have

    def all_outside(self, exclude: str) -> list[HeldRecord]:
        return [r for h in HOSPITALS if h != exclude for r in self.records(h)]
