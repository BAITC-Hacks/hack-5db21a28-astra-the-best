"""Build the five synthetic game zones from a dated OSM boundary snapshot.

Requires Shapely: python -m pip install shapely
Input: public/geo/astana-osm-source.json (Nominatim lookup, 2026-09-23)
Output: public/geo/astana-game-zones.geojson
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/geo/astana-osm-source.json"
OUTPUT = ROOT / "public/geo/astana-game-zones.geojson"

CITY = "3087155"
ESIL = "3479876"
ALMATY = "3482819"
SARYARKA = "3486954"
BAIKONUR = "8593081"
NURA = "20593940"
SARAYSHYK = "19733918"


def build() -> dict:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    boundaries = {str(item["osm_id"]): shape(item["geojson"]) for item in source}
    expected = {CITY, ESIL, ALMATY, SARYARKA, BAIKONUR, NURA, SARAYSHYK}
    if set(boundaries) != expected:
        raise ValueError(f"Unexpected OSM boundary IDs: {set(boundaries) ^ expected}")
    if any(not polygon.is_valid for polygon in boundaries.values()):
        raise ValueError("Source has invalid polygons")

    city = boundaries[CITY]
    # The current OSM Esil relation still overlaps most of Nura. Give Nura
    # precedence, making the five *game* zones disjoint and explicit.
    zones = [
        ("esil", "Есиль", boundaries[ESIL].difference(boundaries[NURA]), [ESIL, NURA]),
        ("almaty", "Алматы", unary_union([boundaries[ALMATY], boundaries[SARAYSHYK]]), [ALMATY, SARAYSHYK]),
        ("saryarka", "Сарыарка", boundaries[SARYARKA], [SARYARKA]),
        ("baikonur", "Байконур", boundaries[BAIKONUR], [BAIKONUR]),
        ("nura", "Нура", boundaries[NURA], [NURA]),
    ]
    geometries = []
    assigned = None
    for _, _, polygon, _ in zones:
        clipped = polygon.intersection(city)
        disjoint = clipped if assigned is None else clipped.difference(assigned)
        geometries.append(disjoint)
        assigned = disjoint if assigned is None else assigned.union(disjoint)
    if any(polygon.is_empty or not polygon.is_valid for polygon in geometries):
        raise ValueError("A generated zone is empty or invalid")
    for index, polygon in enumerate(geometries):
        for other in geometries[index + 1 :]:
            if polygon.intersection(other).area > 1e-10:
                raise ValueError("Game zones overlap")
    coverage = unary_union(geometries)
    if city.difference(coverage).area / city.area > 1e-6:
        raise ValueError("Game zones leave a gap in Astana")
    if coverage.difference(city).area / city.area > 1e-6:
        raise ValueError("Game zones extend outside Astana")

    features = []
    for (district_id, label, _, osm_ids), polygon in zip(zones, geometries):
        anchor = polygon.representative_point()
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": district_id,
                    "name": label,
                    "anchor": [round(anchor.x, 6), round(anchor.y, 6)],
                    "sourceOsmRelationIds": osm_ids,
                    "kind": "illustrative_game_zone",
                },
                "geometry": mapping(polygon),
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "Astana five-zone synthetic simulator geography",
        "bbox": [round(value, 6) for value in city.bounds],
        "features": features,
    }


if __name__ == "__main__":
    data = build()
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(data['features'])} disjoint zones")
