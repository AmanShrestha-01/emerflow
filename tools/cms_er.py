"""Pull every Baltimore-area emergency department from CMS and write web/lib/emer/cms-er.json.

CMS Provider Data (public, no key):
  xubh-q36u  Hospital General Information  -> name, address, "emergency services"
  yv7e-xc69  Timely and Effective Care     -> ER measures: OP_18b (median minutes in the ER),
                                              EDV (yearly ER volume), OP_22 (% left before being seen)
Coordinates come from the US Census geocoder (also public, no key).

These are reported averages (updated quarterly), not live status. The EMS map uses them as each
hospital's baseline and simulates the "right now" numbers on top.

Run:  python3 tools/cms_er.py
"""
import json, math, re, urllib.parse, urllib.request
from pathlib import Path

CENTER = (39.2904, -76.6122)  # downtown Baltimore
RADIUS_MI = 25
OUT = Path(__file__).resolve().parent.parent / "web" / "lib" / "emer" / "cms-er.json"
API = "https://data.cms.gov/provider-data/api/1/datastore/query/{}/0?"

# The ids the capacity map already uses, so Johns Hopkins stays live and the recorded incidents still match.
IDS = {"210009": "jhh", "210002": "shock-trauma", "210029": "bayview", "210008": "mercy", "210038": "midtown",
       "210024": "union-memorial", "210012": "sinai", "210034": "harbor", "210011": "st-agnes",
       "210056": "good-sam", "210044": "gbmc"}
NAMES = {"210002": "UMMC R Adams Cowley Shock Trauma", "210009": "Johns Hopkins Hospital", "210038": "UMMC Midtown Campus",
         "210011": "Ascension Saint Agnes", "210044": "GBMC", "210063": "UM St. Joseph Medical Center",
         "210043": "UM Baltimore Washington Medical Center", "210049": "UM Upper Chesapeake Medical Center",
         "210023": "Luminis Health Anne Arundel Medical Center", "210040": "LifeBridge Northwest Hospital"}
# Each hospital's code in MIEMSS EDAS (Maryland's live ED advisory board), for the live overlay.
EDAS = {"210009": "204", "210002": "215", "210029": "201", "210008": "207", "210038": "206", "210024": "214",
        "210012": "210", "210034": "211", "210011": "212", "210056": "226", "210044": "217", "210015": "203",
        "210023": "221", "210040": "218", "210043": "222", "210048": "223", "210049": "224", "210063": "213"}
# Maryland (MIEMSS) designated adult trauma centers in the area.
TRAUMA = {"210002": "Level I", "210009": "Level I", "210029": "Level II", "210012": "Level II"}


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def cms(dataset):
    q = urllib.parse.urlencode({"conditions[0][property]": "state", "conditions[0][value]": "MD",
                                "conditions[0][operator]": "=", "limit": 1500})
    return get(API.format(dataset) + q)["results"]


def miles(a, b):
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def geocode(address):
    q = urllib.parse.urlencode({"address": address, "benchmark": "Public_AR_Current", "format": "json"})
    m = get("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + q)["result"]["addressMatches"]
    return (round(m[0]["coordinates"]["y"], 5), round(m[0]["coordinates"]["x"], 5)) if m else None


def nice(name):
    s = name.title().replace(", The", "").replace(" Inc", "").replace(",", "")
    for a, b in (("Medstar", "MedStar"), ("Of ", "of "), ("And ", "and "), ("Md ", "MD "), ("Ctr", "Center"), ("Umd ", "UMD ")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def main():
    info = {h["facility_id"]: h for h in cms("xubh-q36u") if h["hospital_type"] == "Acute Care Hospitals"}
    ed = {}
    period = {}
    for m in cms("yv7e-xc69"):
        if m["_condition"] == "Emergency Department":
            ed.setdefault(m["facility_id"], {})[m["measure_id"]] = m["score"]
            period[m["measure_id"]] = f'{m["start_date"]}–{m["end_date"]}'
    out = []
    for fid, h in sorted(info.items()):
        e = ed.get(fid, {})
        # An ER if CMS says so, or if CMS has ER timing for it (MedStar Harbor has an ER but is listed "No").
        if h["emergency_services"] != "Yes" and num(e.get("OP_18b")) is None:
            continue
        address = f'{h["address"]}, {h["citytown"]}, MD {h["zip_code"]}'
        pos = geocode(address)
        if not pos:
            print("  no coordinates:", h["facility_name"], address)
            continue
        if miles(CENTER, pos) > RADIUS_MI:
            continue
        out.append({
            "id": IDS.get(fid, re.sub(r"[^a-z0-9]+", "-", nice(h["facility_name"]).lower()).strip("-")),
            "cms_id": fid,
            "name": NAMES.get(fid, nice(h["facility_name"])),
            "address": f'{h["address"].title()}, {h["citytown"].title()}',
            "lat": pos[0], "lon": pos[1],
            "trauma": TRAUMA.get(fid),
            "edas_code": EDAS.get(fid),
            "ed_minutes": num(e.get("OP_18b")),  # median minutes from arriving to leaving the ER
            "volume": None if e.get("EDV") in (None, "Not Available") else e["EDV"],  # low / medium / high / very high
            "left_unseen_pct": num(e.get("OP_22")),
            "rating": num(h.get("hospital_overall_rating")),
        })
        print(f'  {out[-1]["name"]:<48} {miles(CENTER, pos):5.1f} mi  ER {out[-1]["ed_minutes"]} min  {out[-1]["volume"]}')
    OUT.write_text(json.dumps({
        "source": "CMS Provider Data Catalog (Hospital General Information; Timely and Effective Care, Emergency Department)",
        "periods": {k: period.get(k) for k in ("OP_18b", "EDV", "OP_22")},
        "hospitals": out,
    }, indent=1) + "\n")
    print(f"{len(out)} ERs within {RADIUS_MI} mi -> {OUT}")


if __name__ == "__main__":
    main()
