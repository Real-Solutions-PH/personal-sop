"""reprice ai usage from model prices

Revision ID: 53e98a285909
Revises: 44322cf44dbc
Create Date: 2026-10-22 07:31:32.857346

"""

import math

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "53e98a285909"
down_revision = "44322cf44dbc"
branch_labels = None
depends_on = None


# Prices as of 2026-10-22 (USD per million tokens, the catalogue's figures),
# copied so this revision never changes when the catalogue does.
PRICES = {
    "deepseek-ai/DeepSeek-V4-Flash-0731": (0.14, 0.28),
    "zai-org/GLM-5.3-Flash": (0.15, 0.5),
    "nvidia/Nemotron-3_5-Lightning": (0.06, 0.24),
    "openai/gpt-oss-120b": (0.15, 0.6),
    "Qwen/Qwen3-235B-A22B-Instruct-2507": (0.2, 0.6),
    "Qwen/Qwen3-30B-A3B-Instruct-2507": (0.1, 0.3),
    "reflection/beam": (0.25, 1.0),
    "nvidia/Nemotron-3.5-Super-VL": (0.3, 0.9),
    "deepseek-ai/DeepSeek-V4.1-Flash": (0.3, 1.2),
    "MiniMaxAI/MiniMax-M3": (0.3, 1.2),
    "nvidia/nemotron-3-super-120b-a12b": (0.3, 0.9),
    "Qwen/Qwen3.8-27B": (0.45, 3.0),
    "Qwen/Qwen3.5-397B-A17B": (0.6, 3.6),
    "openbmb/MiniCPM-V-4_5": (0.658, 1.11),
    "moonshotai/Kimi-K2.6": (0.95, 4.0),
    "moonshotai/Kimi-K2.7-Code": (0.95, 4.0),
    "nvidia/Nemotron-3-Ultra-550b-a55b": (1.0, 3.0),
    "NousResearch/Hermes-4-405B": (1.0, 3.0),
    "meta-models/muse-spark-open": (1.25, 4.25),
    "deepseek-ai/DeepSeek-V4-Pro-0813": (1.32, 3.96),
    "zai-org/GLM-5.3": (1.4, 4.4),
    "zai-org/GLM-5.2": (1.4, 4.4),
    "zai-org/GLM-5.1": (1.4, 4.4),
    "deepseek-ai/DeepSeek-V4-Pro": (1.75, 3.5),
    "moonshotai/Kimi-K3": (3.0, 15.0),
    "google/gemma-3-27b-it": (0.1, 0.3),
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": (0.06, 0.24),
}
FALLBACK = (1.0, 3.0)
USD_TO_PHP = 57.0
DEEPGRAM_PER_MIN = 0.0043
WHISPER_PER_MIN = 0.006


def upgrade():
    """Reprice every usage row from its model's own price (the old meter
    used one flat rate, ~20-35x too high). Transcription rows have no
    duration stored, so they are priced as one minute."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, purpose, model, input_tokens, output_tokens, cost_minor "
            "FROM ai_usage"
        )
    ).fetchall()
    for r in rows:
        if r.purpose == "transcription":
            per_min = (
                DEEPGRAM_PER_MIN if r.model.startswith("nova") else WHISPER_PER_MIN
            )
            usd = per_min
        else:
            usd_in, usd_out = PRICES.get(r.model, FALLBACK)
            usd = (
                max(0, r.input_tokens) * usd_in + max(0, r.output_tokens) * usd_out
            ) / 1e6
        cost = (
            0
            if usd <= 0
            or (
                r.purpose != "transcription"
                and r.input_tokens <= 0
                and r.output_tokens <= 0
            )
            else max(1, math.ceil(usd * USD_TO_PHP * 100))
        )
        if cost != r.cost_minor:
            bind.execute(
                sa.text("UPDATE ai_usage SET cost_minor = :c WHERE id = :i"),
                {"c": cost, "i": r.id},
            )


def downgrade():
    """The old flat estimate: 10 centavos per 1k input tokens, 50 per 1k
    output; transcription 34 centavos a minute."""
    op.execute(
        "UPDATE ai_usage SET cost_minor = CASE "
        "WHEN purpose = 'transcription' THEN 34 "
        "WHEN input_tokens <= 0 AND output_tokens <= 0 THEN 0 "
        "ELSE GREATEST(1, CEIL((input_tokens * 10 + output_tokens * 50) / 1000.0))::int END"
    )
