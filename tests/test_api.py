from fastapi.testclient import TestClient

from server.app import app

client = TestClient(app)


def test_meta_and_graph_are_consistent():
    meta = client.get("/api/meta").json()
    graph = client.get("/api/graph").json()
    assert meta["version"] == graph["version"]
    ids = {n["id"] for n in graph["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in graph["edges"])
    assert len({e["id"] for e in graph["edges"]}) == len(graph["edges"])
    assert not any(e["rel"] == "CITES" for e in graph["edges"])


def test_formulate_examples_round_trip():
    for pet in client.get("/api/examples").json():
        r = client.post("/api/formulate", json={**pet, "config": {"min_grade": "B", "max_actives": 4}})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["lines"]) <= 4
        assert body["pet_id"] == pet["pet_id"]


def test_formulate_rejects_unknown_ids():
    pet = client.get("/api/examples").json()[0]
    r = client.post("/api/formulate", json={**pet, "medications": ["med:not_a_drug"]})
    assert r.status_code == 422
