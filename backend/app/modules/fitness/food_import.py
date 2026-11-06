"""Loading public food databases into the shared food library.

    uv run python -m app.modules.fitness.food_import usda|off|philfct [--file F]

(``make food-import SRC=usda``). Each source is read from its own bulk
download, never from a live API:

- ``usda``: USDA FoodData Central, Foundation Foods plus SR Legacy. Public
  domain (CC0), lab-analysed. About 8,000 generic foods: rice, eggs, fruit,
  meat cuts, raw or cooked as USDA says. ``verified``.
- ``off``: Open Food Facts, packaged products sold in the Philippines (plus
  the most-scanned products worldwide that have an English name), from the
  daily CSV export. Crowd-sourced, ODbL: the app credits it wherever a food
  shows its source, and the database itself is never redistributed. Not
  ``verified``.
- ``philfct``: the FNRI Philippine Food Composition Tables, from a CSV in
  ``PHILFCT_COLUMNS``. Nothing is downloaded: the tables sit behind a login
  with no reuse licence, so this loads only a file FNRI has given permission
  for.

The downloads are cached (``--cache-dir``, by default
``~/.cache/unfurl/food-data``, or the temp folder where home is read-only), not kept in git: SR Legacy and Foundation
are ~10 MB zipped and versioned by date, and the Open Food Facts export is
1.5 GB and changes daily (and its licence asks that we not redistribute it).

Re-running updates rather than duplicates: a row is keyed by its source id
(``external_ref``: ``usda:<fdc id>``, ``off:<barcode>``). A food whose name
another live food already has is skipped and counted, so an import never
overwrites a food the household made. A food someone deleted stays deleted.
"""

import argparse
import csv
import gzip
import io
import logging
import os
import re
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.modules.fitness.food_library import FoodDraft, fold
from app.modules.fitness.models import FoodItem
from app.shared.context import Ctx

log = logging.getLogger(__name__)


def default_cache(home: Path | None = None) -> Path:
    """Where downloads are cached: ``~/.cache/unfurl/food-data``, or the
    system temp folder when the home folder cannot be written (the
    production container runs as a user whose home does not exist)."""
    home = Path.home() if home is None else home
    probe = home
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    if os.access(probe, os.W_OK):
        return home / ".cache" / "unfurl" / "food-data"
    return Path(tempfile.gettempdir()) / "unfurl-food-data"


FDC = "https://fdc.nal.usda.gov/fdc-datasets/"
USDA_FILES = {
    # Newest first: a food in both keeps the Foundation (newer, lab) values.
    "foundation": "FoodData_Central_foundation_food_csv_2026-04-30.zip",
    "sr_legacy": "FoodData_Central_sr_legacy_food_csv_2018-04.zip",
}
OFF_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
OFF_FILE = "en.openfoodfacts.org.products.csv.gz"

# FoodData Central nutrient ids, first found wins.
USDA_NUTRIENTS: dict[str, tuple[int, ...]] = {
    # Energy; Foundation foods often carry only the Atwater figures.
    "kcal": (1008, 2048, 2047),
    "protein": (1003,),
    "carbs": (1005, 1050),
    "fat": (1004,),
    "fiber": (1079,),
    "sat_fat": (1258,),
    "fiber_soluble": (1082,),
    "fiber_insoluble": (1084,),
    # The library's sugar is ADDED sugar; USDA's total sugars (2000) is not.
    "sugar": (1235,),
    "sodium": (1093,),  # mg
}
REQUIRED = ("kcal", "protein", "carbs", "fat")

# Names a Filipino household uses for a USDA food, by its exact USDA
# description (checked against the 2018-04 SR Legacy and 2026-04-30
# Foundation files; a description no file has is reported by the import).
# Only names that mean this one food: "kanin" is cooked white rice, but
# "manok" is any chicken, so it is not here (a one-word alias would stand
# in for every chicken dish).
USDA_ALIASES: dict[str, list[str]] = {
    "Rice, white, long-grain, regular, enriched, cooked": [
        "kanin",
        "white rice",
        "cooked white rice",
        "steamed rice",
        "cooked rice",
    ],
    "Rice, white, long-grain, regular, raw, enriched": [
        "bigas",
        "uncooked white rice",
        "raw white rice",
    ],
    "Rice, brown, long-grain, cooked (Includes foods for USDA's Food "
    "Distribution Program)": ["brown rice", "cooked brown rice"],
    "Rice, white, glutinous, unenriched, cooked": [
        "malagkit",
        "sticky rice",
        "glutinous rice",
    ],
    "Egg, whole, raw, fresh": ["egg", "eggs", "itlog", "whole egg", "raw egg"],
    "Egg, whole, cooked, hard-boiled": [
        "hard boiled egg",
        "boiled egg",
        "nilagang itlog",
    ],
    "Egg, whole, cooked, fried": ["fried egg", "pritong itlog", "sunny side up"],
    "Egg, whole, cooked, scrambled": ["scrambled egg", "scrambled eggs"],
    "Egg, white, raw, fresh": ["egg white", "egg whites"],
    "Bananas, raw": ["banana", "saging", "lakatan"],
    "Plantains, ripe, raw": ["saba", "saba banana", "plantain"],
    "Mangos, raw": ["mango", "mangga", "ripe mango"],
    "Papayas, raw": ["papaya", "papaya fruit"],
    "Pineapple, raw": ["pineapple", "pinya"],
    "Avocados, raw, all commercial varieties": ["avocado", "abokado"],
    "Chicken, broilers or fryers, breast, meat only, cooked, roasted": [
        "chicken breast",
        "cooked chicken breast",
        "grilled chicken breast",
    ],
    "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw": [
        "raw chicken breast"
    ],
    "Chicken, broilers or fryers, thigh, meat only, cooked, roasted": [
        "chicken thigh",
        "roasted chicken thigh",
    ],
    "Pork, fresh, belly, raw": ["liempo", "pork belly", "raw pork belly"],
    "Fish, tilapia, cooked, dry heat": ["tilapia", "cooked tilapia"],
    "Fish, milkfish, cooked, dry heat": ["bangus", "milkfish", "cooked bangus"],
    "Fish, milkfish, raw": ["raw bangus", "raw milkfish"],
    "Water convolvulus, cooked, boiled, drained, without salt": [
        "kangkong",
        "cooked kangkong",
    ],
    "Cabbage, chinese (pak-choi), raw": ["pechay", "bok choy", "pak choi"],
    "Squash, winter, all varieties, raw": ["kalabasa", "squash"],
    "Sweet potato, cooked, boiled, without skin": [
        "kamote",
        "boiled kamote",
        "boiled sweet potato",
    ],
    "Potatoes, boiled, cooked without skin, flesh, without salt": [
        "boiled potato",
        "patatas",
    ],
    "Oats, whole grain, rolled, old fashioned": ["oats", "rolled oats"],
    "Milk, whole, 3.25% milkfat, with added vitamin D": ["whole milk", "fresh milk"],
    "Bread, white, commercially prepared (includes soft bread crumbs)": [
        "white bread",
        "loaf bread",
        "tasty bread",
    ],
    "Bread, pan dulce, sweet yeast bread": ["pan dulce"],
    "Tofu, raw, firm, prepared with calcium sulfate": ["tofu", "tokwa", "firm tofu"],
    "Peanut butter, smooth style, without salt": ["peanut butter"],
    "Peanuts, all types, dry-roasted, with salt": ["mani", "roasted peanuts"],
    "Garlic, raw": ["bawang", "garlic"],
    "Sugars, granulated": ["sugar", "white sugar", "asukal"],
    "Oil, coconut": ["coconut oil"],
    "Fish, tuna, light, canned in water, drained solids": [
        "canned tuna in water",
        "tuna in water",
    ],
    "Yogurt, Greek, plain, nonfat": ["greek yogurt", "nonfat greek yogurt"],
    "Spinach, raw": ["spinach", "raw spinach"],
    "Broccoli, cooked, boiled, drained, without salt": [
        "broccoli",
        "boiled broccoli",
    ],
    "Oranges, raw, all commercial varieties": ["orange"],
}


# Measures that are one natural piece, for ``unit_grams`` ("2 eggs" needs
# an egg's weight). Cups and spoons are volumes, not pieces: an amount in
# them goes through its grams instead.
PIECE_WORDS = {
    "large",
    "medium",
    "small",
    "piece",
    "slice",
    "fruit",
    "item",
    "unit",
    "each",
    "egg",
    "link",
    "patty",
    "breast",
    "thigh",
    "drumstick",
    "wing",
    "cookie",
    "bar",
    "roll",
    "muffin",
    "biscuit",
    "pancake",
    "doughnut",
    "banana",
    "fillet",
    "chop",
    "tortilla",
    "bun",
}
COOKED_WORDS = re.compile(
    r"\b(cooked|boiled|roasted|fried|baked|grilled|braised|steamed|broiled|"
    r"stewed|microwaved|heated|toasted|simmered|poached|pan-fried|scrambled|"
    r"hard-boiled|prepared)\b",
    re.I,
)
RAW_WORDS = re.compile(r"\braw\b", re.I)


def state_of(description: str) -> str | None:
    """Raw or cooked, where the name says so ("Egg, whole, raw, fresh")."""
    if RAW_WORDS.search(description):
        return "raw"
    if COOKED_WORDS.search(description):
        return "cooked"
    return None


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


def fetch(url: str, dest: Path) -> Path:
    """``dest``, downloaded from ``url`` the first time."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    log.info("downloading %s", url)
    req = urllib.request.Request(url, headers={"User-Agent": "unfurl-food-import"})
    with urllib.request.urlopen(req, timeout=60) as r, part.open("wb") as out:
        while chunk := r.read(1 << 20):
            out.write(chunk)
    part.rename(dest)
    return dest


def _zip_csv(z: zipfile.ZipFile, name: str) -> Iterator[dict[str, str]]:
    path = next(n for n in z.namelist() if n.endswith("/" + name) or n == name)
    with z.open(path) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", newline=""))


def _id(v: str) -> int:
    """A numeric id column; -1 for a blank or malformed one (never a food)."""
    return int(v) if v.strip().isdigit() else -1


def _r2(v: float | None) -> float | None:
    return None if v is None else round(v, 2)


def _num(v: str | None) -> float | None:
    if v is None or v.strip() == "":
        return None
    try:
        x = float(v)
    except ValueError:
        return None
    return x if x == x and x >= 0 else None  # NaN and negatives are not data


# ---------------------------------------------------------------------------
# USDA FoodData Central
# ---------------------------------------------------------------------------


# A measure naming any of these is a volume, a weight or a pack, or a
# cooking yield ("unit (yield from 1 lb ready-to-cook chicken)"), not a piece.
NOT_PIECE_WORDS = {
    "cup",
    "cups",
    "tbsp",
    "tsp",
    "tablespoon",
    "teaspoon",
    "oz",
    "lb",
    "fl",
    "package",
    "container",
    "can",
    "jar",
    "bottle",
    "yield",
    "cubic",
    "quart",
    "pint",
    "nlea",
    "serving",
}


def _unit_grams(portions: list[tuple[str, float]], description: str) -> float | None:
    """One natural piece's weight from a food's portions ((measure, grams
    per one)): a medium one first (a large one for eggs)."""
    pieces = []
    for m, g in portions:
        words = set(re.findall(r"[a-z]+", m.lower()))
        if g > 0 and words & PIECE_WORDS and not words & NOT_PIECE_WORDS:
            pieces.append((m.lower(), g))
    if not pieces:
        return None
    order = ["large", "medium"] if description.lower().startswith("egg") else []
    order += ["medium", "large", "piece", "each"]
    for word in order:
        for m, g in pieces:
            if re.search(rf"\b{word}\b", m) and "extra" not in m:
                return round(g, 1)
    return round(pieces[0][1], 1)


def usda_drafts(zips: Iterable[Path]) -> Iterator[FoodDraft]:
    """Every food of the given FoodData Central CSV downloads that has
    calories and all three macros, per 100 g."""
    named: set[str] = set()
    for path in zips:
        with zipfile.ZipFile(path) as z:
            kind = "foundation" if "foundation" in path.name else "sr_legacy"
            ids = {
                _id(r["fdc_id"])
                for r in _zip_csv(
                    z,
                    "foundation_food.csv"
                    if kind == "foundation"
                    else "sr_legacy_food.csv",
                )
            }
            names = {
                _id(r["fdc_id"]): r["description"].strip()
                for r in _zip_csv(z, "food.csv")
                if _id(r["fdc_id"]) in ids
            }
            wanted = {n for ns in USDA_NUTRIENTS.values() for n in ns}
            amounts: dict[int, dict[int, float]] = {}
            for r in _zip_csv(z, "food_nutrient.csv"):
                fid, nid = _id(r["fdc_id"]), _id(r["nutrient_id"])
                if (
                    fid in ids
                    and nid in wanted
                    and (v := _num(r["amount"])) is not None
                ):
                    amounts.setdefault(fid, {})[nid] = v
            units = {r["id"]: r["name"] for r in _zip_csv(z, "measure_unit.csv")}
            portions: dict[int, list[tuple[str, float]]] = {}
            for r in _zip_csv(z, "food_portion.csv"):
                fid = _id(r["fdc_id"])
                amount = _num(r["amount"])
                # "0.5 breast, bone and skin removed: 86 g" is a 172 g breast.
                if fid not in ids or amount not in (0.5, 1):
                    continue
                g = _num(r["gram_weight"])
                g = g / amount if g and amount else g
                unit = units.get(r["measure_unit_id"], "")
                measure = " ".join(
                    x
                    for x in (
                        unit if unit != "undetermined" else "",
                        r["modifier"],
                        r["portion_description"],
                    )
                    if x
                )
                if g:
                    portions.setdefault(fid, []).append((measure, g))
        for fid in sorted(names):
            got = amounts.get(fid, {})
            values: dict[str, float | None] = {
                k: next((got[n] for n in ns if n in got), None)
                for k, ns in USDA_NUTRIENTS.items()
            }
            if any(values[k] is None for k in REQUIRED):
                continue
            values = {k: None if v is None else round(v, 2) for k, v in values.items()}
            name = names[fid]
            named.add(name)
            yield FoodDraft(
                name=name[:160],
                kcal=float(values["kcal"] or 0),
                protein=float(values["protein"] or 0),
                carbs=float(values["carbs"] or 0),
                fat=float(values["fat"] or 0),
                fiber=values["fiber"],
                sat_fat=values["sat_fat"],
                fiber_soluble=values["fiber_soluble"],
                fiber_insoluble=values["fiber_insoluble"],
                sugar=values["sugar"],
                sodium=values["sodium"],
                basis="100g",
                unit_grams=_unit_grams(portions.get(fid, []), name),
                state=state_of(name),
                aliases=list(USDA_ALIASES.get(name, [])),
                source="usda",
                source_url=f"https://fdc.nal.usda.gov/food-details/{fid}/nutrients",
                external_ref=f"usda:{fid}",
                notes=f"USDA FoodData Central, {'Foundation Foods' if kind == 'foundation' else 'SR Legacy'} (public domain)",
                verified=True,
            )
    for gone in sorted(set(USDA_ALIASES) - named):
        log.warning("no USDA food is described %r: its aliases were not used", gone)


# ---------------------------------------------------------------------------
# Open Food Facts
# ---------------------------------------------------------------------------

OFF_COUNTRY = "en:philippines"
# Products not listed for the Philippines are taken only when this many
# distinct people have scanned them (the top ~1,000 of 4.9 million) and
# they are sold in an English-speaking market: the global brands that
# also reach Philippine shelves, named in English.
OFF_GLOBAL_MIN_SCANS = 200
OFF_GLOBAL_COUNTRIES = (
    "en:united-states",
    "en:united-kingdom",
    "en:australia",
    "en:canada",
    "en:singapore",
    "en:malaysia",
)
_BARCODE = re.compile(r"^\d{8,14}$")


def _plausible(kcal: float, p: float, c: float, f: float) -> bool:
    """Per-100 g values that can be one food: no more than 100 g of
    macros, no more than 900 kcal, and calories near 4p + 4c + 9f (within
    a quarter, or 40 kcal for light foods; fiber and alcohol explain the
    rest)."""
    if p + c + f > 101 or kcal > 900:
        return False
    atwater = 4 * p + 4 * c + 9 * f
    return abs(kcal - atwater) <= max(40.0, 0.25 * max(kcal, atwater))


def off_name(product: str, brands: str) -> str:
    """ "Product (Brand)", unless the product name already says the brand."""
    product = " ".join(product.split())
    brand = " ".join(brands.split(",")[0].split())
    if brand and fold(brand) not in fold(product):
        return f"{product} ({brand})"[:160]
    return product[:160]


def off_drafts(
    path: Path, *, global_min_scans: int = OFF_GLOBAL_MIN_SCANS
) -> Iterator[FoodDraft]:
    """Products from the Open Food Facts CSV export sold in the Philippines,
    or scanned by ``global_min_scans`` people and sold in an English-speaking
    market, with plausible per-100 g calories and macros."""
    csv.field_size_limit(sys.maxsize)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as f:
        rows = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        head = next(rows)
        ix = {k: i for i, k in enumerate(head)}

        def get(row: list[str], k: str) -> str:
            i = ix.get(k)
            return row[i] if i is not None and i < len(row) else ""

        seen: set[str] = set()
        for row in rows:
            if len(row) != len(head):
                continue
            code = get(row, "code").strip()
            if not _BARCODE.match(code) or code in seen:
                continue
            countries = get(row, "countries_tags")
            if OFF_COUNTRY not in countries:
                scans = _num(get(row, "unique_scans_n")) or 0
                if scans < global_min_scans or not any(
                    c in countries for c in OFF_GLOBAL_COUNTRIES
                ):
                    continue
            product = get(row, "product_name").strip()
            # A product with no brand is often a generic name typed in
            # ("Pancit Canton", "Rice"): it would answer the dish itself.
            if not product or not get(row, "brands").strip():
                continue
            kcal = _num(get(row, "energy-kcal_100g"))
            if kcal is None and (kj := _num(get(row, "energy_100g"))) is not None:
                kcal = round(kj / 4.184, 1)
            p, c, fat = (
                _num(get(row, k))
                for k in ("proteins_100g", "carbohydrates_100g", "fat_100g")
            )
            if kcal is None or p is None or c is None or fat is None:
                continue
            if not _plausible(kcal, p, c, fat):
                continue
            sodium = _num(get(row, "sodium_100g"))
            kcal, p, c, fat = (round(x, 2) for x in (kcal, p, c, fat))
            seen.add(code)
            yield FoodDraft(
                name=off_name(product, get(row, "brands")),
                kcal=kcal,
                protein=p,
                carbs=c,
                fat=fat,
                fiber=_r2(_num(get(row, "fiber_100g"))),
                sat_fat=_r2(_num(get(row, "saturated-fat_100g"))),
                sugar=_r2(_num(get(row, "added-sugars_100g"))),
                sodium=round(sodium * 1000, 1) if sodium is not None else None,
                basis="100g",
                state="as_sold",
                source="off",
                source_url=f"https://world.openfoodfacts.org/product/{code}",
                external_ref=f"off:{code}",
                barcode=code,
                notes="Open Food Facts (ODbL), per 100 g as sold",
                verified=False,
            )


# ---------------------------------------------------------------------------
# PhilFCT (FNRI) — only with FNRI's permission
# ---------------------------------------------------------------------------

PHILFCT_COLUMNS = (
    "food_id",  # FNRI's food id, e.g. "A001"
    "name",  # English name
    "filipino_name",  # one or more, comma-separated
    "state",  # raw, cooked, as_sold or blank
    "kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sodium_mg",
)


def philfct_drafts(path: Path) -> Iterator[FoodDraft]:
    """Rows of a PhilFCT CSV in ``PHILFCT_COLUMNS``, per 100 g edible
    portion. Only for a file FNRI has given permission to use."""
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            missing = [c for c in PHILFCT_COLUMNS if c not in r]
            if missing:
                raise ValueError(
                    f"PhilFCT CSV is missing columns: {', '.join(missing)}"
                )
            kcal, p, c, fat = (
                _num(r[k]) for k in ("kcal", "protein_g", "carbs_g", "fat_g")
            )
            if not r["name"].strip() or None in (kcal, p, c, fat):
                continue
            yield FoodDraft(
                name=r["name"].strip()[:160],
                kcal=float(kcal or 0),
                protein=float(p or 0),
                carbs=float(c or 0),
                fat=float(fat or 0),
                fiber=_num(r["fiber_g"]),
                sodium=_num(r["sodium_mg"]),
                basis="100g",
                state=(r["state"].strip() or None)
                if r["state"].strip() in ("raw", "cooked", "as_sold", "")
                else None,
                aliases=[a.strip() for a in r["filipino_name"].split(",") if a.strip()],
                source="philfct",
                external_ref=f"philfct:{r['food_id'].strip()}",
                notes="Philippine Food Composition Tables, FNRI-DOST (used with permission)",
                verified=True,
            )


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

_VALUE_FIELDS = (
    "name",
    "key",
    "basis",
    "unit_grams",
    "state",
    "kcal",
    "protein",
    "carbs",
    "fat",
    "fiber",
    "sat_fat",
    "fiber_soluble",
    "fiber_insoluble",
    "sugar",
    "sodium",
    "source",
    "source_url",
    "notes",
    "verified",
    "barcode",
)


@dataclass
class ImportResult:
    read: int = 0
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped_name_taken: int = 0
    skipped_deleted: int = 0
    seconds: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def upsert_drafts(
    ctx: Ctx, drafts: Iterable[FoodDraft], *, batch: int = 500
) -> ImportResult:
    """Add or update imported foods by their ``external_ref``. A draft whose
    folded name another live food already holds is skipped (the household's
    own food, or an earlier draft of this import, keeps it); aliases that
    are another food's name are dropped. Commits every ``batch`` rows."""
    t0 = time.monotonic()
    res = ImportResult()
    s: Session = ctx.session
    tenant = ctx.tenant_id
    by_ref: dict[str, FoodItem] = {}
    holders: dict[str, Any] = {}  # folded name -> id of the live food holding it
    deleted_refs: set[str] = set()
    for r in s.exec(select(FoodItem).where(col(FoodItem.tenant_id) == tenant)).all():
        if r.deleted_at is not None:
            if r.external_ref:
                deleted_refs.add(r.external_ref)
            continue
        holders[r.key] = r.id
        if r.external_ref:
            by_ref[r.external_ref] = r
    pending = 0
    for d in drafts:
        res.read += 1
        ref = d.external_ref or ""
        key = fold(d.name)[:160]
        if not key:
            continue
        if ref in deleted_refs and ref not in by_ref:
            res.skipped_deleted += 1
            continue
        row = by_ref.get(ref)
        if holders.get(key) not in (None, row.id if row else None):
            res.skipped_name_taken += 1
            continue
        aliases = sorted(
            {
                a
                for a in (fold(x)[:160] for x in d.aliases)
                if a and a != key and holders.get(a) in (None, row.id if row else None)
            }
        )
        values: dict[str, Any] = {
            "name": d.name.strip()[:160],
            "key": key,
            "basis": d.basis,
            "unit_grams": d.unit_grams,
            "state": d.state,
            "kcal": d.kcal,
            "protein": d.protein,
            "carbs": d.carbs,
            "fat": d.fat,
            "fiber": d.fiber,
            "sat_fat": d.sat_fat,
            "fiber_soluble": d.fiber_soluble,
            "fiber_insoluble": d.fiber_insoluble,
            "sugar": d.sugar,
            "sodium": d.sodium,
            "source": d.source,
            "source_url": d.source_url,
            "notes": d.notes,
            "verified": d.verified,
            "barcode": d.barcode,
        }
        if row is None:
            row = FoodItem(**values, aliases=aliases, external_ref=ref, **ctx.owned())
            s.add(row)
            by_ref[ref] = row
            res.added += 1
        else:
            # Aliases learned since (a name the household calls it) stay.
            merged = sorted(set(row.aliases or []) | set(aliases))
            if row.key != key:
                holders.pop(row.key, None)
            if all(getattr(row, k) == values[k] for k in _VALUE_FIELDS) and merged == (
                row.aliases or []
            ):
                res.unchanged += 1
                continue
            for k in _VALUE_FIELDS:
                setattr(row, k, values[k])
            row.aliases = merged
            row.updated_at = ctx.now
            s.add(row)
            res.updated += 1
        holders[key] = row.id
        pending += 1
        if pending >= batch:
            s.commit()
            pending = 0
    s.commit()
    res.seconds = round(time.monotonic() - t0, 1)
    return res


def drafts_for(source: str, *, file: Path | None, cache: Path) -> Iterator[FoodDraft]:
    if source == "usda":
        zips = (
            [file] if file else [fetch(FDC + n, cache / n) for n in USDA_FILES.values()]
        )
        return usda_drafts(zips)
    if source == "off":
        return off_drafts(file or fetch(OFF_URL, cache / OFF_FILE))
    if source == "philfct":
        if file is None:
            raise SystemExit(
                "philfct needs --file: a CSV FNRI has given permission for"
            )
        return philfct_drafts(file)
    raise SystemExit(f"unknown source {source!r}: usda, off or philfct")


def main(argv: list[str] | None = None) -> int:
    from app.core.config import settings
    from app.core.db import engine
    from app.modules.iam.users.models import User

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source", choices=["usda", "off", "philfct"])
    ap.add_argument("--file", type=Path, help="read this download instead of fetching")
    ap.add_argument("--cache-dir", type=Path, default=default_cache())
    ap.add_argument(
        "--owner-email",
        default=settings.FIRST_SUPERUSER,
        help="the admin the imported foods are filed under (default FIRST_SUPERUSER)",
    )
    ap.add_argument("--dry-run", action="store_true", help="count, write nothing")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    drafts = drafts_for(a.source, file=a.file, cache=a.cache_dir)
    if a.dry_run:
        n = sum(1 for _ in drafts)
        print(f"{a.source}: {n} foods would be imported")  # noqa: T201
        return 0
    with Session(engine) as session:
        user = session.exec(
            select(User).where(col(User.email) == a.owner_email)
        ).first()
        if user is None or not user.is_superuser:
            raise SystemExit(f"{a.owner_email} is not an admin user in this database")
        res = upsert_drafts(Ctx(session=session, user=user), drafts)
    print(f"{a.source}: {res.as_dict()}")  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
