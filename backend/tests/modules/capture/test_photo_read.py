"""Reading photos with several readers: preparing the image, voting each
label number, and what Fern is told. Pure functions, no database."""

import io
import json
from typing import Any

from PIL import Image

from app.modules.capture import photo_read as pr


def answer(**photo: Any) -> str:
    return "Here you go:\n" + json.dumps({"photos": [photo]})


LABEL = {
    "kind": "label",
    "product": "Monster Ultra",
    "serving_size": "240 mL",
    "servings_per_container": "About 1.5",
}


def test_a_number_two_readers_agree_on_is_kept() -> None:
    m = pr.merge_photo(
        [
            answer(**LABEL, per_serving={"kcal": 6, "protein_g": 0, "fat_g": 5.8}),
            answer(**LABEL, per_serving={"kcal": 6, "protein_g": 0, "fat_g": 5.6}),
            answer(**LABEL, per_serving={"kcal": 60, "protein_g": 0, "fat_g": 5.8}),
        ]
    )
    assert m is not None
    assert m["per_serving"] == {"kcal": 6, "fat_g": 5.8, "protein_g": 0}
    assert m["unclear"] == {}
    assert m["readers"] == 3


def test_numbers_the_readers_disagree_on_are_asked_about_not_guessed() -> None:
    m = pr.merge_photo(
        [
            answer(**LABEL, per_serving={"kcal": 90, "protein_g": 10}),
            answer(**LABEL, per_serving={"kcal": 90, "protein_g": 3.3}),
            answer(**LABEL, per_serving={"kcal": 30, "protein_g": 11}),
        ]
    )
    assert m is not None
    assert m["per_serving"] == {"kcal": 90}
    assert m["unclear"] == {"per_serving.protein_g": [10, 3.3, 11]}
    text = pr.render([m], "1 photo")
    assert "Per serving: 90 kcal." in text
    assert "Unclear, ask before using: protein (read as 10, 3.3, 11)" in text


def test_a_value_only_one_reader_saw_is_dropped_as_a_guess() -> None:
    # One reader invented a per 100 g column and a scale reading the others
    # could not see; neither reaches Fern.
    m = pr.merge_photo(
        [
            answer(**LABEL, per_serving={"kcal": 133}, per_100g={"kcal": 380}),
            answer(**LABEL, per_serving={"kcal": 133}, scale_g=267),
            answer(**LABEL, per_serving={"kcal": 133}),
        ]
    )
    assert m is not None
    assert "per_100g" not in m
    assert m["scale_g"] is None
    assert m["unclear"] == {}


def test_one_reader_alone_is_taken_as_read() -> None:
    m = pr.merge_photo([answer(**LABEL, per_serving={"kcal": 6}), None, "not json"])
    assert m is not None
    assert m["readers"] == 1 and m["per_serving"] == {"kcal": 6}


def test_a_meal_lists_its_foods_from_the_first_reader() -> None:
    meal = {"kind": "meal", "what": "noodles with chicken"}
    m = pr.merge_photo(
        [
            answer(
                **meal,
                foods=[
                    {"name": "pancit canton", "grams": 250, "how": "estimate"},
                    {"name": "chicken drumstick", "grams": 110, "how": "scale"},
                ],
                scale_g=360,
            ),
            answer(**meal, foods=[{"name": "noodles", "grams": 200}], scale_g=360),
            None,
        ]
    )
    assert m is not None
    text = pr.render([m], "1 photo")
    assert "Photo 1 — meal: noodles with chicken" in text
    assert "Foods: pancit canton about 250 g; chicken drumstick weighed 110 g." in text
    assert "Kitchen scale shows 360 g." in text


def test_a_photo_no_reader_could_read_says_so() -> None:
    merged = pr.merge(
        [[answer(**LABEL, per_serving={"kcal": 6})], [None, "sorry, I can't"]]
    )
    text = pr.render(merged, "2 photos")
    assert "Photo 2 — could not be read just now." in text
    assert pr.merge([[None, None]]) == []


def _jpeg(w: int, h: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(out, "JPEG")
    return out.getvalue()


def test_a_small_photo_is_enlarged_and_a_huge_one_shrunk() -> None:
    small, mime = pr.prepare(_jpeg(512, 683), "image/jpeg")
    assert mime == "image/jpeg"
    assert max(Image.open(io.BytesIO(small)).size) == pr.MIN_EDGE
    big, _ = pr.prepare(_jpeg(4032, 3024), "image/jpeg")
    assert max(Image.open(io.BytesIO(big)).size) == pr.MAX_EDGE


def test_an_undecodable_photo_is_sent_as_it_came() -> None:
    assert pr.prepare(b"not an image", "image/png") == (b"not an image", "image/png")
