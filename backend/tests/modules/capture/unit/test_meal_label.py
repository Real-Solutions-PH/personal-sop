"""The meal type a Snap it caption starts with becomes the meal's label."""

import pytest

from app.modules.capture.photo import meal_label_of


@pytest.mark.parametrize(
    ("caption", "label"),
    [
        ("Lunch: 2 pcs adobo, half rice", "lunch"),
        ("Breakfast", "breakfast"),
        ("Midnight snack: chips", "snack"),
        ("snack: banana", "snack"),
        ("Almusal: tapsilog", "breakfast"),
        ("Hapunan", "dinner"),
        ("2 pcs adobo for lunch", None),
        ("", None),
    ],
)
def test_the_caption_names_the_meal(caption: str, label: str | None) -> None:
    assert meal_label_of(caption) == label
