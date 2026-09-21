from app.utils.cluster_users import normalize_cluster_username


def test_normalize_cluster_username_rejects_path_traversal():
    try:
        normalize_cluster_username("../alice")
    except ValueError as exc:
        assert "Invalid cluster username" in str(exc)
    else:
        raise AssertionError("Expected invalid cluster username to be rejected")


def test_normalize_cluster_username_accepts_trimmed_login():
    assert normalize_cluster_username(" alice_13 ") == "alice_13"
