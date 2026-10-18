"""Pure rules: CSV parsing, the advisor intent and answer, rollover, money
bounds. Expected values are hand-read from the inputs, never produced by the
code under test."""

from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.finance import advisor, calc
from app.modules.finance import schema as S
from app.modules.finance.imports import (
    LAYOUTS,
    CsvError,
    parse_amount,
    parse_csv,
    parse_date_time,
)
from app.shared.money import MAX_MINOR
from tests.modules.finance.unit.golden import data, state

# --- CSV --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "minor"),
    [
        ("180.00", 18_000),
        ("₱1,234.50", 123_450),
        ("PHP 3,000", 300_000),
        ("-45.5", -4_550),
        ("(250.00)", -25_000),
        ("100.00 CR", 10_000),
        ("100.00 DR", -10_000),
        ("", None),
        ("  ", None),
        ("-", None),
    ],
)
def test_parse_amount(text: str, minor: int | None) -> None:
    assert parse_amount(text) == minor


@pytest.mark.parametrize("text", ["abc", "1.005", "nan", "inf", "1e400", "12,3,4.5x"])
def test_parse_amount_refuses(text: str) -> None:
    with pytest.raises(ValueError):
        parse_amount(text)


def test_parse_amount_bounds() -> None:
    assert parse_amount("1000000000000.00") == MAX_MINOR
    with pytest.raises(ValueError):
        parse_amount("1000000000000.01")


@pytest.mark.parametrize(
    ("text", "want"),
    [
        ("2026-10-01", (date(2026, 10, 1), None)),
        ("10/01/2026", (date(2026, 10, 1), None)),
        ("2026-10-01 14:05", (date(2026, 10, 1), "14:05")),
        ("10/01/2026 2:05 PM", (date(2026, 10, 1), "14:05")),
        ("Oct 01, 2026", (date(2026, 10, 1), None)),
        ("01 Oct 2026", (date(2026, 10, 1), None)),
        ("2026-10-01T09:30:15", (date(2026, 10, 1), "09:30")),
    ],
)
def test_parse_date_time(text: str, want: tuple[date, str | None]) -> None:
    assert parse_date_time(text) == want


def test_gcash_layout_with_preamble_blank_lines_and_quotes() -> None:
    text = (
        "﻿GCash Transaction History\n"
        "Account: 0917*****12\n"
        "Date and Time,Description,Reference No.,Debit,Credit,Balance\n"
        '2026-10-01 12:10 PM,Payment to JOLLIBEE FOODS CORP,7001,180.00,,"1,000.00"\n'
        "\n"
        '2026-10-02 09:00,"Cash-in, via InstaPay",7002,,"3,000.00",4000.00\n'
        "2026-10-03 22:02,PENDING — Payment to SHOPEEPAY,7003,749.00,,\n"
    )
    rows = parse_csv(text, LAYOUTS["gcash"])
    assert [
        (r.date, r.time, r.raw, r.amount, r.direction, r.ref, r.pending) for r in rows
    ] == [
        (
            date(2026, 10, 1),
            "12:10",
            "Payment to JOLLIBEE FOODS CORP",
            18_000,
            "out",
            "7001",
            False,
        ),
        (
            date(2026, 10, 2),
            "09:00",
            "Cash-in, via InstaPay",
            300_000,
            "in",
            "7002",
            False,
        ),
        (
            date(2026, 10, 3),
            "22:02",
            "PENDING — Payment to SHOPEEPAY",
            74_900,
            "out",
            "7003",
            True,
        ),
    ]


def test_bpi_layout_semicolons() -> None:
    text = (
        "Transaction Date;Description;Reference Number;Debit;Credit;Running Balance\n"
        "Oct 05, 2026;RENT;R1;12,000.00;;56,000.00\n"
        "Oct 15, 2026;PAYROLL NORTHWIND;R2;;27,500.00;83,500.00\n"
    )
    rows = parse_csv(text, LAYOUTS["bpi"])
    assert [(r.date, r.amount, r.direction, r.time) for r in rows] == [
        (date(2026, 10, 5), 1_200_000, "out", "12:00"),
        (date(2026, 10, 15), 2_750_000, "in", "12:00"),
    ]


def test_generic_mapping_signed_amount_and_separate_time() -> None:
    m = S.CsvMapping(
        date="Posted",
        description="Details",
        amount="Amt",
        time="At",
        date_format="%d/%m/%Y",
    )
    rows = parse_csv("Posted,At,Details,Amt\n02/10/2026,7:15 PM,Grab ride,-212.00\n", m)
    assert [(r.date, r.time, r.amount, r.direction) for r in rows] == [
        (date(2026, 10, 2), "19:15", 21_200, "out")
    ]


@pytest.mark.parametrize(
    ("text", "code", "row"),
    [
        ("Nope,Header\n1,2\n", "csv_header_not_found", None),
        ("Date,Memo\n2026-10-01,x\n", "csv_columns_missing", None),
        ("Date,Memo,Amount\n2026-13-01,x,1\n", "csv_row_invalid", 1),
        ("Date,Memo,Amount\n2026-10-01,x,1\n2026-10-02,y,0\n", "csv_row_invalid", 2),
        ("Date,Memo,Amount\n2026-10-01,,1\n", "csv_row_invalid", 1),
    ],
)
def test_csv_refusals(text: str, code: str, row: int | None) -> None:
    m = S.CsvMapping(date="Date", description="Memo", amount="Amount")
    with pytest.raises(CsvError) as exc:
        parse_csv(text, m)
    assert (exc.value.code, exc.value.row) == (code, row)


def test_debit_and_credit_both_filled_is_refused() -> None:
    m = LAYOUTS["bpi"]
    text = "Transaction Date,Description,Reference Number,Debit,Credit\n2026-10-01,X,1,5.00,5.00\n"
    with pytest.raises(CsvError):
        parse_csv(text, m)


def test_mapping_needs_amount_columns() -> None:
    with pytest.raises(ValidationError):
        S.CsvMapping(date="d", description="x", debit="dr")


# --- Advisor ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "key", "amount", "n"),
    [
        # "0%" is a rate and "12 months" a term: no amount, so the default.
        (
            "Should I finance this phone at 0% for 12 months or pay cash?",
            "finance",
            3_000_000,
            12,
        ),
        ("0% installment for 30k?", "finance", 3_000_000, 12),
        ("finance a 24,999 phone over 6 mos", "finance", 2_499_900, 12),
        ("Can I afford a 45k laptop in December?", "afford", 4_500_000, None),
        ("can I buy a 1500.50 bag", "afford", 150_050, None),
        ("can i buy it", "afford", 4_500_000, None),
        ("where does my money go", "leaks", None, None),
        ("is my emergency fund ok", "emergency", None, None),
        ("should I invest in MP2", "invest", None, None),
        ("how did i do last month", "review", None, None),
        ("hello", "generic", None, None),
    ],
)
def test_advisor_question(
    text: str, key: str, amount: int | None, n: int | None
) -> None:
    q = advisor.advisor_question(text)
    assert (q.key, q.amount_minor, q.n) == (key, amount, n)


def _texts(ans: dict[str, Any]) -> str:
    return "".join(seg.get("t", "") for para in ans["paragraphs"] for seg in para)


def test_advisor_answers_over_the_seed() -> None:
    s = state()
    g = data()
    floor = round(g["seed"]["settings"]["safetyFloor"] * 100)
    for text in (
        "afford a 45k laptop",
        "0% installment",
        "leak",
        "emergency fund",
        "invest",
        "review last month",
        "hi",
    ):
        ans = advisor.answer(
            s, advisor.advisor_question(text), scope="records", safety_floor_minor=floor
        )
        assert ans["paragraphs"] and ans["disclaimer"] == advisor.DISCLAIMER
        for para in ans["paragraphs"]:
            for seg in para:
                assert set(seg) <= {"t", "m", "k"}
                if "m" in seg or "k" in seg:
                    assert isinstance(seg.get("m", seg.get("k")), int)
        assert "₱" not in _texts(ans)  # amounts are segments, never baked into text
    emergency = advisor.answer(
        s,
        advisor.advisor_question("emergency"),
        scope="aggregates",
        safety_floor_minor=floor,
    )
    runway = g["stats"]["runway"]
    assert f"{runway:.1f} months" in _texts(emergency)
    gated = advisor.answer(
        s,
        advisor.advisor_question("leak"),
        scope="aggregates",
        safety_floor_minor=floor,
    )
    assert gated["needs_records"] and gated["actions"][0]["kind"] == "allow_records"


# --- Rollover (a server ruling; the prototype stores the flag only) ----------


def test_rollover_carries_unspent_and_never_debt() -> None:
    s = calc.State(
        today=date(2026, 10, 18),
        accounts=[calc.Acct(id="a", type="cash", opening=0)],
        records=[
            calc.Rec(
                id="r1",
                type="expense",
                amount=60_000,
                account_id="a",
                day=date(2026, 8, 10),
            ),
            calc.Rec(
                id="r2",
                type="expense",
                amount=150_000,
                account_id="a",
                day=date(2026, 9, 10),
            ),
            calc.Rec(
                id="r3",
                type="expense",
                amount=10_000,
                account_id="a",
                day=date(2026, 10, 2),
            ),
        ],
    )
    b = calc.Bud(
        id="b",
        name="All",
        category_ids=None,
        limit=100_000,
        rollover=True,
        start_date=date(2026, 8, 1),
    )
    # Aug: 100k - 60k = 40k carried into Sep. Sep: 140k - 150k -> 0 (no debt).
    assert calc.rollover_carry(s, b, "2026-09") == 40_000
    assert calc.rollover_carry(s, b, "2026-10") == 0
    v = calc.budget_view(s, b, "2026-09")
    assert (v.limit, v.carry, v.pct) == (140_000, 40_000, 150_000 / 140_000)
    off = calc.Bud(
        id="c",
        name="All",
        category_ids=None,
        limit=100_000,
        start_date=date(2026, 8, 1),
    )
    assert calc.budget_view(s, off, "2026-09").limit == 100_000


# --- Money bounds at the schema edge ------------------------------------------


@pytest.mark.parametrize("amount", [0, -1, MAX_MINOR + 1])
def test_record_amount_bounds(amount: int) -> None:
    with pytest.raises(ValidationError):
        S.RecordCreate(
            type="expense",
            amount_minor=amount,
            account_id="00000000-0000-4000-8000-000000000001",
        )  # type: ignore[arg-type]


def test_money_bounds_on_every_amount_field() -> None:
    acct = "00000000-0000-4000-8000-000000000001"
    S.RecordCreate(type="expense", amount_minor=MAX_MINOR, account_id=acct)  # type: ignore[arg-type]
    for bad in (
        lambda: S.RecordCreate(
            type="transfer", amount_minor=1, account_id=acct, fee_minor=-1
        ),  # type: ignore[arg-type]
        lambda: S.AccountCreate(name="x", type="cash", opening_minor=-MAX_MINOR - 1),
        lambda: S.AccountCreate(name="x", type="credit", limit_minor=0),
        lambda: S.BudgetCreate(name="x", limit_minor=0),
        lambda: S.PlannedCreate.model_validate(
            {
                "name": "x",
                "type": "expense",
                "amount_minor": MAX_MINOR + 1,
                "account_id": acct,
                "schedule": {"kind": "monthly", "day": 1},
            }
        ),
        lambda: S.SettingsFields(safety_floor_minor=-1),
        lambda: S.AdjustBalance(actual_minor=MAX_MINOR + 1),
        lambda: S.WhatIfIn(amount_minor=0, month="2026-10"),
        lambda: S.ExtractedRow(
            date=date(2026, 10, 1), raw="x", amount_minor=0, direction="out"
        ),
    ):
        with pytest.raises(ValidationError):
            bad()
    S.AccountCreate(name="x", type="cash", opening_minor=-MAX_MINOR)
    S.AdjustBalance(actual_minor=-MAX_MINOR)
