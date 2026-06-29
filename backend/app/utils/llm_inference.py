import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from app.config.logging import get_logger
from app.config.config import settings
from app.utils.infrastructure import get_vec_inf_log_base_dir

# IMPORTANT: Set VEC_INF env vars BEFORE importing vec-inf.
# vec-inf loads/caches config at import time.
if getattr(settings, "VEC_INF_CONFIG_DIR", None):
    os.environ["VEC_INF_CONFIG_DIR"] = str(settings.VEC_INF_CONFIG_DIR)
if getattr(settings, "VEC_INF_ACCOUNT", None) or getattr(settings, "SLURM_ACCOUNT", None):
    os.environ["VEC_INF_ACCOUNT"] = str(
        getattr(settings, "VEC_INF_ACCOUNT", None) or settings.SLURM_ACCOUNT
    )
if getattr(settings, "VEC_INF_WORK_DIR", None):
    os.environ["VEC_INF_WORK_DIR"] = str(settings.VEC_INF_WORK_DIR)

# Python SDK for vec-inf (imported AFTER env vars are set)
from vec_inf.client.api import VecInfClient
from vec_inf.client.models import LaunchOptions

logger = get_logger("llm_inference")


class LLMInferenceClient:
    """Client for interacting with the llm-inference package via Python API."""

    def __init__(self):
        vec_inf_config_dir = getattr(settings, "VEC_INF_CONFIG_DIR", None)
        if vec_inf_config_dir:
            logger.info("Using VEC_INF_CONFIG_DIR: %s", vec_inf_config_dir)
            self._verify_config_files(vec_inf_config_dir)
        else:
            logger.info("VEC_INF_CONFIG_DIR not set, using vec-inf default config location")
        
        # MODEL_CONFIG_PATH can still be used for explicit models.yaml path override
        config_path = getattr(settings, "MODEL_CONFIG_PATH", None)
        if config_path:
            logger.info("Using custom model config path: %s", config_path)
            # If VEC_INF_MODEL_CONFIG is not set, set it from MODEL_CONFIG_PATH
            if not os.getenv("VEC_INF_MODEL_CONFIG"):
                os.environ["VEC_INF_MODEL_CONFIG"] = str(config_path)
                logger.info("Set VEC_INF_MODEL_CONFIG to: %s", config_path)
        
        # Initialize VecInfClient - it will use VEC_INF_CONFIG_DIR if set
        self.client = VecInfClient()
        self.slurm_account = settings.SLURM_ACCOUNT

    @staticmethod
    def _ensure_cuda_visible_devices_env(env_value: Optional[str]) -> str:
        """Ensure we pass Slurm-assigned GPUs into the container.

        vec-inf expects a comma-separated KEY=VALUE list.
        """
        cuda_kv = "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
        if not env_value:
            return cuda_kv

        # Avoid double-injecting the key if the caller already provided it.
        if "CUDA_VISIBLE_DEVICES=" in env_value:
            return env_value

        return f"{env_value},{cuda_kv}"

    def _build_launch_options(self, **params: Optional[Union[str, int, bool]]):
        """Map API payload params to LaunchOptions.

        Supported incoming params:
          - num_gpus -> gpus_per_node
          - num_nodes -> num_nodes
          - partition, qos, time, data_type, resource_type, account
          - max_model_len, max_num_seqs -> vllm_args string
        """
        mapped: Dict[str, Any] = {}

        # Map simple fields
        if params.get("num_nodes") is not None:
            mapped["num_nodes"] = params["num_nodes"]
        if params.get("num_gpus") is not None:
            mapped["gpus_per_node"] = params["num_gpus"]
        if params.get("partition") is not None:
            mapped["partition"] = params["partition"]
        if params.get("qos") is not None:
            mapped["qos"] = params["qos"]
        if params.get("time") is not None:
            time_value = params["time"]
            # Convert integer seconds to HH:MM:SS format if needed
            if isinstance(time_value, int):
                hours = time_value // 3600
                minutes = (time_value % 3600) // 60
                seconds = time_value % 60
                mapped["time"] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                logger.info(f"Converted time from {time_value} seconds to {mapped['time']}")
            elif isinstance(time_value, str):
                # Already in string format, use as-is
                mapped["time"] = time_value
            else:
                # Convert to string if it's another type
                mapped["time"] = str(time_value)
        if params.get("data_type") is not None:
            mapped["data_type"] = params["data_type"]
        if params.get("resource_type") is not None:
            mapped["resource_type"] = params["resource_type"]
        if params.get("venv") is not None:
            mapped["venv"] = params["venv"]
        elif settings.DEFAULT_VENV:
            mapped["venv"] = settings.DEFAULT_VENV

        # Optional working directory for vec-inf jobs
        # This allows API payloads to pass work_dir through to LaunchOptions
        if params.get("work_dir") is not None:
            mapped["work_dir"] = params["work_dir"]

        # Account from settings if not provided
        if params.get("account") is not None:
            mapped["account"] = params["account"]
        elif self.slurm_account:
            mapped["account"] = self.slurm_account
            logger.info(f"Using SLURM account from environment: {self.slurm_account}")

        # vLLM args composition
        # Format: "--max-model-len=8192,--max-num-seqs=256" (comma-separated with equals)
        vllm_parts: List[str] = []
        if params.get("max_model_len") is not None:
            vllm_parts.append(f"--max-model-len={params['max_model_len']}")
        if params.get("max_num_seqs") is not None:
            vllm_parts.append(f"--max-num-seqs={params['max_num_seqs']}")
        # Append any additional vllm_args passed directly
        if params.get("vllm_args") is not None:
            vllm_parts.append(params["vllm_args"])
        if vllm_parts:
            mapped["vllm_args"] = ",".join(vllm_parts)

        # HuggingFace model ID for downloading weights
        if params.get("hf_model") is not None:
            mapped["hf_model"] = params["hf_model"]

        # Model weights parent directory
        if params.get("model_weights_parent_dir") is not None:
            mapped["model_weights_parent_dir"] = params["model_weights_parent_dir"]

        # Cloudflare tunnel currently controlled by CLI flags; SDK support may differ.
        # If SDK exposes it via env/config, wire it here in the future.

        # Environment variables for container jobs (HF_HOME, HF_HUB_CACHE, etc.)
        env_value = params.get("env") or getattr(settings, "VEC_INF_ENV", None)
        mapped["env"] = self._ensure_cuda_visible_devices_env(env_value)

        return LaunchOptions(**mapped)

    def launch_model(self, model_name: str, enable_cloudflare_tunnel: bool = False, **params):
        """Launch a model using the llm-inference Python API."""
        _ = enable_cloudflare_tunnel  # SDK tunnel support is handled externally for now.
        try:
            options = self._build_launch_options(**params)
            resp = self.client.launch_model(model_name, options=options)
            slurm_job_id = getattr(resp, "slurm_job_id", None)
            logger.info(f"Launched model {model_name} -> {slurm_job_id}")
            return {"success": True, "slurm_job_id": slurm_job_id, "job_id": slurm_job_id}
        except Exception as e:
            logger.error(f"Failed to launch model: {e}")
            return {"success": False, "error": str(e)}

    def get_model_status(self, slurm_job_id: str):
        try:
            status = self.client.get_status(slurm_job_id)
            server_status = getattr(status, "server_status", None)
            status_str = getattr(server_status, "value", None) or str(server_status)
            base_url = getattr(status, "base_url", None)
            return {
                "success": True,
                "status": status_str,
                "endpoint_ready": bool(base_url),
                "endpoint_url": base_url,
                "model_name": getattr(status, "model_name", None),
                "pending_reason": getattr(status, "pending_reason", None),
                "failed_reason": getattr(status, "failed_reason", None),
                "job_state": getattr(status, "job_state", None),
            }
        except Exception as e:
            logger.error(f"Failed to get model status: {e}")
            return {"success": False, "error": str(e)}

    def get_model_metrics(self, slurm_job_id: str):
        try:
            metrics = self.client.get_metrics(slurm_job_id)
            return {"success": True, **(metrics if isinstance(metrics, dict) else {"metrics": metrics})}
        except Exception as e:
            logger.error(f"Failed to get model metrics: {e}")
            return {"success": False, "error": str(e)}

    def shutdown_model(self, slurm_job_id: str):
        try:
            result = self.client.shutdown_model(slurm_job_id)
            return {"success": True, "result": result}
        except Exception as e:
            logger.error(f"Failed to shutdown model: {e}")
            return {"success": False, "error": str(e)}

    def list_available_models(self):
        # Prefer models defined in the infrastructure models.yaml;
        # fall back to vec-inf's merged/default list if not found.
        try:
            user_config_path = self._resolve_user_models_config_path()
            if user_config_path:
                import yaml as _yaml
                with open(user_config_path) as fh:
                    raw = _yaml.safe_load(fh) or {}
                names = list(raw.get("models", {}).keys())
                logger.info(
                    "Loaded %d models from infrastructure config: %s",
                    len(names),
                    user_config_path,
                )
                return {"success": True, "models": names}

            # Fallback: no user config found, defer to vec-inf's merged list
            logger.warning(
                "No infrastructure models.yaml found; falling back to vec-inf default model list"
            )
            models = self.client.list_models()
            try:
                names = [getattr(m, "name", str(m)) for m in models]
                return {"success": True, "models": names}
            except Exception:
                return {"success": True, "models": models}
        except Exception as e:
            logger.error(f"Failed to list available models: {e}")
            return {"success": False, "error": str(e)}

    def _resolve_user_models_config_path(self) -> Optional[str]:
        """Return the path to the infrastructure-specific models.yaml, or None."""
        explicit = os.getenv("VEC_INF_MODEL_CONFIG")
        if explicit and Path(explicit).exists():
            return explicit

        config_dir = os.getenv("VEC_INF_CONFIG_DIR")
        if config_dir:
            candidate = Path(config_dir) / "models.yaml"
            if candidate.exists():
                return str(candidate)

        return None

    def get_model_details(self, model_name: str):
        try:
            details = self.client.get_model_config(model_name)
            return {"success": True, "details": details}
        except Exception as e:
            logger.error(f"Failed to get model details: {e}")
            return {"success": False, "error": str(e)}

    def _verify_config_files(self, config_dir: str):
        """Verify that environment.yaml and models.yaml exist in the config directory."""
        config_path = Path(config_dir)
        env_file = config_path / "environment.yaml"
        models_file = config_path / "models.yaml"
        
        if env_file.exists():
            logger.info("Found environment.yaml at: %s", env_file)
        else:
            logger.warning("environment.yaml not found at: %s", env_file)
        
        if models_file.exists():
            logger.info("Found models.yaml at: %s", models_file)
        else:
            model_config_override = os.getenv("VEC_INF_MODEL_CONFIG") or getattr(
                settings, "MODEL_CONFIG_PATH", None
            )
            if model_config_override and Path(model_config_override).exists():
                logger.info(
                    "models.yaml not found at: %s; using model config override at: %s",
                    models_file,
                    model_config_override,
                )
            else:
                logger.warning("models.yaml not found at: %s", models_file)

    def get_tunnel_url(self, job_name: str, slurm_job_id: str):
        """Get the Cloudflare tunnel URL for a deployed model (if available)."""
        # This may need to be implemented based on how the Python API exposes tunnel URLs
        # For now, fallback to the log file method if needed
        import os
        log_base = get_vec_inf_log_base_dir()
        if not log_base:
            logger.error("Vec-inf log directory not configured")
            return None
        tunnel_url_file = os.path.join(log_base, f"{job_name}.{slurm_job_id}.tunnel_url")
        try:
            if os.path.exists(tunnel_url_file):
                with open(tunnel_url_file, "r") as f:
                    tunnel_url = f.read().strip()
                    logger.info(f"Found tunnel URL: {tunnel_url}")
                    return tunnel_url
            else:
                logger.warning(f"Tunnel URL file not found: {tunnel_url_file}")
                return None
        except Exception as e:
            logger.error(f"Error reading tunnel URL file: {e}")
            return None
