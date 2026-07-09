import json
import sys

from app.utils.llm_inference import LLMInferenceDirectClient


def main() -> int:
    if len(sys.argv) != 2:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Expected a single JSON payload argument",
                }
            )
        )
        return 1

    try:
        payload = json.loads(sys.argv[1])
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
