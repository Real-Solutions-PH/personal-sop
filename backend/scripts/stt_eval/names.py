"""The vocabulary a request carries, built the way the server builds it.

``NAMES`` (habits, exercises, accounts) and ``FOODS`` are one person's
library as it stood when the corpus was made; ``keyterms()`` runs them
through the server's own ``capture.vocabulary.keyterms`` so the eval sends
exactly what production would send for that person.
"""

from app.modules.capture.vocabulary import keyterms as server_keyterms

NAMES = [
    "Workout",
    "Fix the bed",
    "Face skin care routine",
    "15 min relaxation",
    "30 min work block",
    "Garden time",
    "Evening journal",
    "Morning journal",
    "Take isotretinoin",
    "Take two fish oil",
    "Run",
    "Plank",
    "Leg Press",
    "Romanian Deadlift",
    "Back Squat",
    "Dumbbell Curl",
    "Face Pull",
    "Pull-up",
    "Lat Pulldown",
    "Barbell Row",
    "Triceps Pushdown",
    "Lateral Raise",
    "Overhead Press",
    "Incline Dumbbell Press",
    "Barbell Bench Press",
    "Maya Black",
    "MariBank",
    "GoTyme",
    "Maya Savings",
    "Maya",
]

FOODS = [
    "MOST Motorist L-Carnitine Energy",
    "Monde Nissin Whole-Grain Oat",
    "Pre-workout shake",
    "Athlene Active Whey Protein",
    "Basil seeds",
    "Betagro Black Pepper Tender",
    "Betagro Garlic Butter Tender",
    "Canned sardines in tomato",
    "Cheesecake",
    "Chicken breast",
    "Chicken liver",
    "Chobani Greek Yogurt Natural",
    "Egg",
    "Emco Müsli Oat Biscuits",
    "Flax seeds",
    "Fried egg in olive",
    "Galunggong",
    "Gardenia Neubake Wheaten Bread",
    "7-Eleven iced mocha",
    "Instant black coffee",
    "Milk Magic Non-Fat Dried",
    "Nescafé Ice Black canned",
    "Nestlé Low-Fat Milk",
    "Pancit canton noodles with",
    "Pancit palabok",
    "Pork longganisa",
    "Quaker Quick Cook Oatmeal",
    "Red Bull Sugarfree",
    "Reese's Sticks bar",
    "Salmon",
    "Shing-a-ling",
    "Skippy creamy peanut butter",
    "White rice",
    "Zaragoza Spanish-style sardines in",
    "Honey butter potato chips",
]


# The server's budget is 800 characters, but Deepgram's ``multi`` model
# refused this list above about 640 (2026-11-14). The owner's real list
# (56 terms, 791 characters) was accepted, so the eval uses a list that
# fits rather than measuring the server's halve-and-retry.
EVAL_MAX_CHARS = 620


def keyterms() -> list[str]:
    out: list[str] = []
    for t in server_keyterms(NAMES, FOODS):
        if sum(map(len, out)) + len(t) > EVAL_MAX_CHARS:
            break
        out.append(t)
    return out
