"""Models the app offers on the server's Nebius Token Factory key.

Checked by hand against the public endpoints list on 2026-10-20
(https://tokenfactory.nebius.com/endpoints). Ids are the API model ids; prices
are USD per million tokens as listed then, shown to the user as a guide only.
Embedding models are left out: nothing in the app chats with one.

Update this list when Nebius adds or retires an endpoint. A user's own
provider key is not limited to it; their provider's ``/models`` list is the
source of truth there.
"""

from dataclasses import dataclass
from typing import Literal

Kind = Literal["text", "vision"]


@dataclass(frozen=True)
class CatalogModel:
    id: str
    label: str
    vendor: str
    kind: Kind
    usd_in: float
    usd_out: float


NEBIUS: tuple[CatalogModel, ...] = (
    CatalogModel(
        "deepseek-ai/DeepSeek-V4-Flash-0731",
        "DeepSeek V4 Flash",
        "DeepSeek",
        "text",
        0.14,
        0.28,
    ),
    CatalogModel(
        "zai-org/GLM-5.3-Flash", "GLM-5.3 Flash", "Z.ai", "vision", 0.15, 0.50
    ),
    CatalogModel(
        "nvidia/Nemotron-3_5-Lightning",
        "Nemotron 3.5 Lightning",
        "NVIDIA",
        "text",
        0.06,
        0.24,
    ),
    CatalogModel("openai/gpt-oss-120b", "gpt-oss-120b", "OpenAI", "text", 0.15, 0.60),
    CatalogModel(
        "Qwen/Qwen3-235B-A22B-Instruct-2507",
        "Qwen3 235B Instruct",
        "Qwen",
        "text",
        0.20,
        0.60,
    ),
    CatalogModel(
        "Qwen/Qwen3-30B-A3B-Instruct-2507",
        "Qwen3 30B Instruct",
        "Qwen",
        "text",
        0.10,
        0.30,
    ),
    CatalogModel(
        "reflection/beam", "Reflection Beam 1.0", "Reflection", "text", 0.25, 1.00
    ),
    CatalogModel(
        "nvidia/Nemotron-3.5-Super-VL",
        "Nemotron 3.5 Super VL",
        "NVIDIA",
        "vision",
        0.30,
        0.90,
    ),
    CatalogModel(
        "deepseek-ai/DeepSeek-V4.1-Flash",
        "DeepSeek V4.1 Flash",
        "DeepSeek",
        "vision",
        0.30,
        1.20,
    ),
    CatalogModel("MiniMaxAI/MiniMax-M3", "MiniMax-M3", "MiniMax", "text", 0.30, 1.20),
    CatalogModel(
        "nvidia/nemotron-3-super-120b-a12b",
        "Nemotron 3 Super 120B",
        "NVIDIA",
        "text",
        0.30,
        0.90,
    ),
    CatalogModel("Qwen/Qwen3.8-27B", "Qwen3.8 27B", "Qwen", "vision", 0.45, 3.00),
    CatalogModel("Qwen/Qwen3.5-397B-A17B", "Qwen3.5 397B", "Qwen", "text", 0.60, 3.60),
    CatalogModel(
        "openbmb/MiniCPM-V-4_5", "MiniCPM-V 4.5", "OpenBMB", "vision", 0.658, 1.11
    ),
    CatalogModel(
        "moonshotai/Kimi-K2.6", "Kimi K2.6", "Moonshot AI", "vision", 0.95, 4.00
    ),
    CatalogModel(
        "moonshotai/Kimi-K2.7-Code",
        "Kimi K2.7 Code",
        "Moonshot AI",
        "text",
        0.95,
        4.00,
    ),
    CatalogModel(
        "nvidia/Nemotron-3-Ultra-550b-a55b",
        "Nemotron 3 Ultra 550B",
        "NVIDIA",
        "text",
        1.00,
        3.00,
    ),
    CatalogModel(
        "NousResearch/Hermes-4-405B",
        "Hermes 4 405B",
        "Nous Research",
        "text",
        1.00,
        3.00,
    ),
    CatalogModel(
        "meta-models/muse-spark-open", "Muse Spark Open", "Meta", "vision", 1.25, 4.25
    ),
    CatalogModel(
        "deepseek-ai/DeepSeek-V4-Pro-0813",
        "DeepSeek V4 Pro (0813)",
        "DeepSeek",
        "text",
        1.32,
        3.96,
    ),
    CatalogModel("zai-org/GLM-5.3", "GLM-5.3", "Z.ai", "text", 1.40, 4.40),
    CatalogModel("zai-org/GLM-5.2", "GLM-5.2", "Z.ai", "text", 1.40, 4.40),
    CatalogModel("zai-org/GLM-5.1", "GLM-5.1", "Z.ai", "text", 1.40, 4.40),
    CatalogModel(
        "deepseek-ai/DeepSeek-V4-Pro", "DeepSeek V4 Pro", "DeepSeek", "text", 1.75, 3.50
    ),
    CatalogModel("moonshotai/Kimi-K3", "Kimi K3", "Moonshot AI", "vision", 3.00, 15.00),
    CatalogModel("google/gemma-3-27b-it", "Gemma 3 27B", "Google", "text", 0.10, 0.30),
    CatalogModel(
        "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
        "Nemotron 3 Nano 30B",
        "NVIDIA",
        "text",
        0.06,
        0.24,
    ),
)

NEBIUS_IDS: frozenset[str] = frozenset(m.id for m in NEBIUS)


def find(model_id: str) -> CatalogModel | None:
    return next((m for m in NEBIUS if m.id == model_id), None)
