"""Shared validation for cluster login names.

Cluster usernames reach the backend from request payloads and end up in
filesystem paths and ``sudo -u`` arguments, so they are validated in exactly
one place: here. Callers normalize at their entry point and pass the result
down; the impersonation helpers assume an already-validated name.

"""

import re

# Conservative login name: leading letter, then letters/digits/dot/underscore/dash.
CLUSTER_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,63}$")


def normalize_cluster_username(cluster_username: str) -> str:
    """Return the trimmed username, or raise ``ValueError`` if it is not valid."""
    username = cluster_username.strip()
    if not CLUSTER_USERNAME_RE.fullmatch(username):
        raise ValueError(f"Invalid cluster username: {cluster_username!r}")
    return username
