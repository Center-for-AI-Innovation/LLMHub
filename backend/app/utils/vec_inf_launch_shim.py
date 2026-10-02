import json
import os
import sys

from app.utils.llm_inference import LLMInferenceDirectClient


def main() -> int:
    if len(sys.argv) != 2:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Expected a single payload-file-path argument",
                }
            )
        )
        return 1

    # The payload arrives as a file path, not inline, because it can carry a
    # secret (hf_token) and command-line arguments are visible to any user on
    # the host via ps/`/proc/<pid>/cmdline`.
    payload_path = sys.argv[1]
    try:
        with open(payload_path, "r") as f:
            raw_payload = f.read()
    except OSError as exc:
        print(
            json.dumps(
                {"success": False, "error": f"Could not read payload file: {exc}"}
            )
        )
        return 1
    finally:
        try:
            os.remove(payload_path)
        except OSError:
            pass

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        print(json.dumps({"success": False, "error": f"Invalid JSON payload: {exc}"}))
        return 1

    if not isinstance(payload, dict):
        print(json.dumps({"success": False, "error": "Payload must be a JSON object"}))
        return 1

    model_name = payload.get("model_name")
    params = payload.get("params") or {}
    enable_cloudflare_tunnel = bool(payload.get("enable_cloudflare_tunnel", False))

    if not isinstance(model_name, str) or not model_name.strip():
        print(json.dumps({"success": False, "error": "model_name is required"}))
        return 1
    if not isinstance(params, dict):
        print(json.dumps({"success": False, "error": "params must be a JSON object"}))
        return 1

    client = LLMInferenceDirectClient()
    result = client.launch_model(
        model_name,
        enable_cloudflare_tunnel=enable_cloudflare_tunnel,
        **params,
    )
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
