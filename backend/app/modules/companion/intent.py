"""What job a chat turn is: decided in code before the model runs.

Fern runs on a cheap model, so the first thing it reads about the turn is a
short line naming the job, what the person expects to see and the fewest
steps that get there. Seen in real chats (2026-10-31): a portion question
was logged instead of answered, "try again" re-read the photo, and "it is
breakfast" confirmed a waiting meal. A separate model call to classify
would add a round trip to every turn; these rules cost nothing, are tested,
and the model still decides, with the line as a strong hint.

Kinds: ``redo`` (the last answer missed; answer the earlier ask again),
``question`` (answer it; log nothing unless also asked), ``edit`` (change
an entry that exists), ``plan`` (suggest, never log), ``log`` (record what
they describe) and ``chat`` (talk).
"""

import re
from dataclasses import dataclass
from typing import Literal

Kind = Literal["redo", "question", "edit", "plan", "log", "chat"]

# The whole message says the last answer missed. Short on purpose: "try
# again with 2 cups" is a new ask that happens to say "again".
_REDO = re.compile(
    r"^\W*(?:no[,.!]?\s+)?(?:try again|again|retry|redo( it)?|wrong|that'?s wrong|"
    r"that'?s not (?:it|right|what i asked)|not that|nope|answer\W*|"
    r"(?:you )?(?:didn'?t|did not) answer(?: (?:me|my question|the question))?|"
    r"answer (?:me|my question|the question)|huh|what|"
    r"that'?s not what i (?:asked|meant)|ulit|mali)\W*$",
    re.I,
)
# Inside a longer message: "you didn't answer what I asked", "I asked for X".
_REDO_IN = re.compile(
    r"\b(?:not what i (?:asked|meant)|(?:didn'?t|did not) answer|"
    r"answer (?:my|the) question|i asked (?:for|about|you)|read my message|"
    r"that'?s not what)\b",
    re.I,
)
# A correction of something already recorded.
_EDIT = re.compile(
    r"\b(?:it(?:'s| is| was) (?:breakfast|lunch|dinner|a snack|snack|merienda)|"
    r"actually|should (?:be|have been)|instead|change|fix|correct(?:ion)?|"
    r"rename|move (?:it|that|this)|push (?:it|that|this)|reschedule|"
    r"(?:note|add) (?:it|that|this) (?:to|as|in)|"
    r"not \d[\d,.]*|wrong (?:amount|number|meal|time|day)|make (?:it|that) )\b",
    re.I,
)
_PLAN = re.compile(
    r"\b(?:what should i (?:eat|have|cook|do)|suggest|recommend|meal plan|"
    r"plan (?:my|the|for)|ideas? for|what can i eat)\b",
    re.I,
)
_QUESTION_START = re.compile(
    r"^\s*(?:what|what'?s|whats|how|why|when|where|which|who|is|are|am|do|does|"
    r"did|can|could|should|would|will|give me|tell me|show me|list|compare|"
    r"estimate|explain|ilan|magkano|ano|bakit|paano)\b",
    re.I,
)
_QUESTION_IN = re.compile(
    r"\b(?:portion(?:s|ing)?|how (?:much|many)|what (?:will|would) be|"
    r"estimated?|left (?:for|today)|end result|in able to|so i can|"
    r"enough|vs\.?|versus|compared?)\b",
    re.I,
)
# Asking for grams per food: the portion planner's job.
_PORTIONS = re.compile(
    r"\b(?:portion(?:s|ing)?|how (?:much|many) (?:grams?|g|cups?)|"
    r"grams? (?:of|for)|serving sizes?|how much (?:should|can|do) i eat)\b",
    re.I,
)
_LOG = re.compile(
    r"\b(?:add|log|record|remind|create|set up|schedule|save|mark|complete|"
    r"finish(?:ed)?|spent|paid|bought|ate|had|eaten|drank|ran|weigh(?:ed)?|"
    r"journal|track)\b|\d(?:[.,]\d+)?\s*(?:kg|lbs?|km|mins?|reps?|kcal|pesos?|php)\b"
    r"|[₱$]\s*\d",
    re.I,
)
_CHAT = re.compile(
    r"^\W*(?:hi|hello|hey|thanks?|thank you|ty|ok(?:ay)?|cool|nice|good "
    r"(?:morning|night|evening)|salamat|sige)\W*$",
    re.I,
)


@dataclass(frozen=True)
class Intent:
    kind: Kind
    expects: str
    portions: bool = False


def classify(text: str) -> Intent:
    """The job of the person's latest message (its photo reading left out)."""
    said = text.split("\n\n[", 1)[0].strip()
    words = said.split()
    portions = bool(_PORTIONS.search(said))
    if _REDO.match(said) or (len(words) <= 14 and _REDO_IN.search(said)):
        return Intent(
            "redo",
            "a new answer to their earlier message, fixing exactly what was "
            "missing or wrong (not a re-read of a photo unless they ask)",
        )
    if _CHAT.match(said):
        return Intent("chat", "a short friendly line")
    if portions:
        return Intent(
            "question",
            "grams for every food, each with its kcal and protein, the meal "
            "total and what is left today: call portion_plan",
            portions=True,
        )
    asks = said.rstrip().endswith("?") or bool(_QUESTION_START.match(said))
    if _EDIT.search(said) and not asks:
        return Intent("edit", "the entry changed as they said, in a few words")
    if _PLAN.search(said):
        return Intent(
            "plan", "concrete suggestions with amounts; suggestions are not logs"
        )
    if asks or _QUESTION_IN.search(said):
        return Intent(
            "question", "the answer first, with numbers and units from a tool"
        )
    if _LOG.search(said):
        return Intent("log", "what was saved or waits, in a few words")
    return Intent("chat" if len(words) <= 4 else "log", "a short, direct reply")


def turn_note(
    intent: Intent, *, previous_ask: str = "", previous_answer: str = ""
) -> str:
    """The system prompt's THIS TURN block."""
    lines = [
        "THIS TURN (decided from their words; follow it unless their message "
        "clearly says otherwise):",
        f"- Job: {intent.kind}. They expect: {intent.expects}.",
    ]
    if intent.kind == "redo" and previous_ask:
        lines.append(
            f'- Redo your answer to their earlier message: "{previous_ask[:300]}". '
            "Address exactly what it asked, in the format it needs."
        )
        if previous_answer:
            lines.append(
                f'- Your answer that missed: "{previous_answer[:300]}". Do not '
                "repeat it."
            )
    if intent.kind in ("question", "plan"):
        lines.append("- Do not log anything this turn unless they also asked you to.")
    if intent.kind == "edit":
        lines.append(
            "- Change the existing entry with its edit tool (find it first). "
            "A waiting entry stays waiting; never confirm or re-create it."
        )
    if previous_answer and intent.kind != "redo":
        last = previous_answer.strip().splitlines()[-1][:200]
        lines.append(
            f'- Your last reply ended: "{last}". Do not repeat that suggestion.'
        )
    return "\n".join(lines)
