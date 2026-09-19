"""Plain data for the simulated hospital. No logic beyond small helpers."""
from __future__ import annotations

from dataclasses import dataclass, field

# Closed vocabulary of clinical facts a placement can depend on.
FACTS: tuple[str, ...] = (
    "anticoagulant",
    "penicillin_allergy",
    "vitals_stable",
    "icu_need",
    "on_pressors",
    "blood_type",
)

# Bed-holding units inside the hospital, plus two off-site destinations.
UNITS: tuple[str, ...] = (
    "RESUS", "ER", "HALLWAY", "ICU", "STEPDOWN", "WARD", "OR", "PACU", "LOUNGE",
)
OFFSITE: tuple[str, ...] = ("HOME", "PARTNER")
DESTINATIONS: tuple[str, ...] = UNITS + OFFSITE

# Patient life-cycle states.
STATES: tuple[str, ...] = ("incoming", "waiting", "placed", "held", "discharged", "transferred")


@dataclass
class Claim:
    """One fact as asserted by one source record."""
    fact: str
    value: str
    status: str  # "present" | "active" | "stopped" | "absent"
    resource_id: str


@dataclass
class SourceRecord:
    source_id: str
    source_name: str
    recorded_date: str  # ISO YYYY-MM-DD
    claims: dict[str, Claim] = field(default_factory=dict)  # fact -> claim; missing = "not mentioned"


@dataclass
class Patient:
    pid: str
    name: str
    age: int
    complaint: str
    severity: int  # 1 = most critical (ESI)
    arrived_at: int  # sim minute (or ETA for incoming)
    state: str = "waiting"
    unit: str | None = None
    sources: list[SourceRecord] = field(default_factory=list)
    needs_ct: bool = False
    ct_done: bool = False
    needs_blood: bool = False
    blood_type: str = "O+"
    improving: bool = False          # ICU/STEPDOWN patient who could step down
    ready_for_discharge: bool = False
    ready_at: int | None = None      # sim minute they became ready to go home
    elective: bool = False           # scheduled elective surgery patient
    retriage_flag: bool = False
    placed_at: int | None = None
    moved_at: int | None = None     # last time this patient changed unit
    records_flag: bool = False       # placed under emergency override despite a records conflict
    verified: set[str] = field(default_factory=set)  # facts a human already checked across sources


@dataclass
class Unit:
    name: str
    beds: int
    occupants: list[str] = field(default_factory=list)
    reserved: dict[str, int] = field(default_factory=dict)  # pid -> reservation expiry minute

    @property
    def used(self) -> int:
        return len(self.occupants) + len(self.reserved)

    @property
    def free(self) -> int:
        return max(0, self.beds - self.used)


@dataclass
class ORCase:
    case_id: str
    pid: str
    kind: str  # "elective" | "urgent"
    starts_at: int
    ends_at: int
    cancelled: bool = False


@dataclass
class Move:
    """A proposed patient movement. `because` is owned by code (rules.REQUIRED_FACTS)."""
    move_id: str
    pid: str
    from_unit: str | None
    to_unit: str
    kind: str  # "admit" | "transfer" | "discharge" | "transfer_out"
    because: list[str] = field(default_factory=list)
    source: str = "swarm"  # "fastlane" | "swarm" | "fallback" | "baseline"
    depends_on: list[str] = field(default_factory=list)
    reason: str = ""


@dataclass
class Escalation:
    action_id: str
    action: str  # see rules.ESCALATION_ACTIONS
    level: int
    reason: str
    params: dict = field(default_factory=dict)
    needs_approval: bool = True


@dataclass
class ConflictVersion:
    source_name: str
    recorded_date: str
    value: str
    status: str
    resource_id: str


@dataclass
class Conflict:
    fact: str
    versions: list[ConflictVersion]
    reason: str


@dataclass
class Verdict:
    conflicts: list[Conflict] = field(default_factory=list)
    blocking: bool = True  # False for life-saving destinations (placed with a records flag)

    @property
    def clear(self) -> bool:
        return not self.conflicts
