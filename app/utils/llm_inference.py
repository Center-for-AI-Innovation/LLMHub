import os
from pathlib import Path
from typing import Dict, List, Optional, Any, Union

from app.config.logging import get_logger
from app.config.config import settings

# Python SDK for vec-inf
from vec_inf.client.api import VecInfClient, ModelStatus
from vec_inf.client.models import LaunchOptions
from vec_inf.client._helper import ModelRegistry
from vec_inf.client._slurm_vars import load_env_config
from vec_inf.client._utils import load_config

logger = get_logger("llm_inference")


class LLMInferenceClient:
    """Client for interacting with the llm-inference package via Python API."""

    def __init__(self):
        # Set VEC_INF_CONFIG_DIR if configured in settings
        # This tells vec-inf where to find environment.yaml and models.yaml
        vec_inf_config_dir = getattr(settings, 'VEC_INF_CONFIG_DIR', None)
        if vec_inf_config_dir:
            os.environ['VEC_INF_CONFIG_DIR'] = vec_inf_config_dir
            logger.info(f"Set VEC_INF_CONFIG_DIR to: {vec_inf_config_dir}")
            # Verify config files exist
            self._verify_config_files(vec_inf_config_dir)
        else:
            logger.info("VEC_INF_CONFIG_DIR not set, using vec-inf default config location")
        
        # MODEL_CONFIG_PATH can still be used for explicit models.yaml path override
        config_path = getattr(settings, 'MODEL_CONFIG_PATH', None)
        if config_path:
            logger.info(f"Using custom model config path: {config_path}")
            # If VEC_INF_MODEL_CONFIG is not set, set it from MODEL_CONFIG_PATH
            if not os.getenv('VEC_INF_MODEL_CONFIG'):
                os.environ['VEC_INF_MODEL_CONFIG'] = config_path
                logger.info(f"Set VEC_INF_MODEL_CONFIG to: {config_path}")
        
        # Initialize VecInfClient - it will use VEC_INF_CONFIG_DIR if set
        self.client = VecInfClient()
        self.slurm_log_dir = settings.SLURM_LOG_DIR
        self.slurm_account = settings.SLURM_ACCOUNT
        
        # Log which config files are being used
        self._log_config_usage()

    def _build_launch_options(self, enable_cloudflare_tunnel: bool, **params: Optional[Union[str, int, bool]]):
        """Map API payload params to LaunchOptions.

        Supported incoming params:
          - num_gpus -> gpus_per_node
          - num_nodes -> num_nodes
          - partition, qos, time, data_type, account
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
        if params.get("venv") is not None:
            mapped["venv"] = params["venv"]
        elif settings.DEFAULT_VENV:
            mapped["venv"] = settings.DEFAULT_VENV
            logger.info(f"Using default venv from settings: {settings.DEFAULT_VENV}")

        # Account from settings if not provided
        if params.get("account") is not None:
            mapped["account"] = params["account"]
        elif self.slurm_account:
            mapped["account"] = self.slurm_account
            logger.info(f"Using SLURM account from environment: {self.slurm_account}")

        # vLLM args composition
        vllm_parts: List[str] = []
        if params.get("max_model_len") is not None:
            vllm_parts += ["--max-model-len", str(params["max_model_len"])]
        if params.get("max_num_seqs") is not None:
            vllm_parts += ["--max-num-seqs", str(params["max_num_seqs"])]
        if vllm_parts:
            mapped["vllm_args"] = " ".join(vllm_parts)

        # Cloudflare tunnel currently controlled by CLI flags; SDK support may differ.
        # If SDK exposes it via env/config, wire it here in the future.

        return LaunchOptions(**mapped)

    def launch_model(self, model_name: str, enable_cloudflare_tunnel: bool = False, **params):
        """Launch a model using the llm-inference Python API."""
        try:
            options = self._build_launch_options(enable_cloudflare_tunnel, **params)
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
            # status is likely an enum; normalize to string
            status_str = status.name if hasattr(status, "name") else str(status)
            return {"success": True, "status": status_str}
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
        try:
            models = self.client.list_models()
            # Normalize to a simple list of names if ModelInfo objects
            try:
                names = [getattr(m, "name", str(m)) for m in models]
                return {"success": True, "models": names}
            except Exception:
                return {"success": True, "models": models}
        except Exception as e:
            logger.error(f"Failed to list available models: {e}")
            return {"success": False, "error": str(e)}

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
            logger.info(f"✓ Found environment.yaml at: {env_file}")
        else:
            logger.warning(f"✗ environment.yaml not found at: {env_file}")
        
        if models_file.exists():
            logger.info(f"✓ Found models.yaml at: {models_file}")
        else:
            logger.warning(f"✗ models.yaml not found at: {models_file}")

    def _log_config_usage(self):
        """Log which configuration files are actually being used by vec-inf."""
        try:
            # Log environment variables that affect config loading
            vec_inf_config_dir = os.getenv('VEC_INF_CONFIG_DIR')
            vec_inf_model_config = os.getenv('VEC_INF_MODEL_CONFIG')
            model_config_path = os.getenv('MODEL_CONFIG_PATH')
            
            logger.info("=" * 60)
            logger.info("vec-inf Configuration Loading:")
            if vec_inf_config_dir:
                logger.info(f"  VEC_INF_CONFIG_DIR: {vec_inf_config_dir}")
                models_file = Path(vec_inf_config_dir) / "models.yaml"
                env_file = Path(vec_inf_config_dir) / "environment.yaml"
                logger.info(f"  Expected models.yaml: {models_file} (exists: {models_file.exists()})")
                logger.info(f"  Expected environment.yaml: {env_file} (exists: {env_file.exists()})")
            else:
                logger.info("  VEC_INF_CONFIG_DIR: Not set")
            
            if vec_inf_model_config:
                logger.info(f"  VEC_INF_MODEL_CONFIG: {vec_inf_model_config} (exists: {Path(vec_inf_model_config).exists()})")
            else:
                logger.info("  VEC_INF_MODEL_CONFIG: Not set")
            
            if model_config_path:
                logger.info(f"  MODEL_CONFIG_PATH: {model_config_path} (exists: {Path(model_config_path).exists()})")
            else:
                logger.info("  MODEL_CONFIG_PATH: Not set")
            
            # Check environment config
            env_config = load_env_config()
            logger.info(f"  Loaded environment config - image_path: {env_config.get('paths', {}).get('image_path', 'N/A')}")
            logger.info(f"  Environment config limits - max_gpus_per_node: {env_config.get('limits', {}).get('max_gpus_per_node', 'N/A')}")
            
            # Check models config - this will show which file was actually loaded
            models = load_config()
            logger.info(f"  Loaded {len(models)} model configurations from models.yaml")
            if models:
                logger.info(f"  Sample models: {', '.join([m.model_name for m in models[:5]])}")
                # Check if any model has integer time (which would indicate wrong config)
                for model in models[:10]:  # Check first 10 models
                    if hasattr(model, 'time') and isinstance(model.time, int):
                        logger.warning(f"  ⚠️  Model '{model.model_name}' has integer time value: {model.time} (should be string HH:MM:SS)")
                        break
            
            # Determine which config file vec-inf actually used
            # vec-inf loads from: 1) VEC_INF_MODEL_CONFIG, 2) VEC_INF_CONFIG_DIR/models.yaml, 3) CACHED_CONFIG_DIR/models.yaml, 4) package default
            if vec_inf_model_config and Path(vec_inf_model_config).exists():
                actual_path = Path(vec_inf_model_config).resolve()
                logger.info(f"  ✓ models.yaml loaded from: {actual_path}")
            elif vec_inf_config_dir:
                actual_path = Path(vec_inf_config_dir) / "models.yaml"
                if actual_path.exists():
                    logger.info(f"  ✓ models.yaml loaded from: {actual_path.resolve()}")
                else:
                    logger.warning(f"  ✗ Expected models.yaml not found at: {actual_path}")
                    logger.info("  → Falling back to vec-inf default location")
            else:
                # Check cached location
                cached_path = Path("/model-weights/vec-inf-shared/models.yaml")
                if cached_path.exists():
                    logger.info(f"  ✓ models.yaml loaded from cached location: {cached_path}")
                else:
                    logger.info("  ✓ models.yaml loaded from vec-inf package defaults")
            
            logger.info("=" * 60)
                
        except Exception as e:
            logger.warning(f"Could not verify config loading: {e}")
            import traceback
            logger.warning(traceback.format_exc())

    def get_tunnel_url(self, job_name: str, slurm_job_id: str):
        """Get the Cloudflare tunnel URL for a deployed model (if available)."""
        # This may need to be implemented based on how the Python API exposes tunnel URLs
        # For now, fallback to the log file method if needed
        import os
        if not self.slurm_log_dir:
            logger.error("Slurm log directory not specified")
            return None
        tunnel_url_file = os.path.join(self.slurm_log_dir, f"{job_name}.{slurm_job_id}.tunnel_url")
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
