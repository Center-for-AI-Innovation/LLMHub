import json
import os
import pwd
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import yaml

from app.config.config import settings
from app.config.logging import get_logger
from app.utils.infrastructure import get_vec_inf_log_base_dir

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _apply_vec_inf_environment() -> None:
    """Set vec-inf env vars before importing the SDK."""
    if getattr(settings, "VEC_INF_CONFIG_DIR", None) and not os.getenv("VEC_INF_CONFIG_DIR"):
        os.environ["VEC_INF_CONFIG_DIR"] = str(settings.VEC_INF_CONFIG_DIR)
    if (
        not os.getenv("VEC_INF_ACCOUNT")
        and (getattr(settings, "VEC_INF_ACCOUNT", None) or getattr(settings, "SLURM_ACCOUNT", None))
    ):
        os.environ["VEC_INF_ACCOUNT"] = str(
            getattr(settings, "VEC_INF_ACCOUNT", None) or settings.SLURM_ACCOUNT
        )
    if getattr(settings, "VEC_INF_WORK_DIR", None) and not os.getenv("VEC_INF_WORK_DIR"):
        os.environ["VEC_INF_WORK_DIR"] = str(settings.VEC_INF_WORK_DIR)
    if getattr(settings, "VEC_INF_LOG_DIR", None) and not os.getenv("VEC_INF_LOG_DIR"):
        os.environ["VEC_INF_LOG_DIR"] = str(settings.VEC_INF_LOG_DIR)


# IMPORTANT: Set VEC_INF env vars BEFORE importing vec-inf.
# vec-inf loads/caches config at import time.
_apply_vec_inf_environment()

# Python SDK for vec-inf (imported AFTER env vars are set)
from vec_inf.client.api import VecInfClient
from vec_inf.client.models import LaunchOptions

logger = get_logger("llm_inference")

_ACCOUNT_LINE_RE = re.compile(r"^(?P<account>\S+)\s+\d+\s+\d+\s+.+$")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
_CLUSTER_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,63}$")


def _normalize_cluster_username(cluster_username: str) -> str:
    username = cluster_username.strip()
    if not _CLUSTER_USERNAME_RE.fullmatch(username):
        raise RuntimeError(f"Invalid cluster username: {cluster_username!r}")
    return username


def _resolve_impersonated_workspace_root() -> Optional[Path]:
    raw_root = getattr(settings, "VEC_INF_SHARED_WORK_ROOT", None) or get_vec_inf_log_base_dir()
    if not isinstance(raw_root, str) or not raw_root.strip():
        return None
    return Path(raw_root).expanduser()


def _resolve_impersonated_workspace_dir(cluster_username: str) -> Optional[Path]:
    cluster_username = _normalize_cluster_username(cluster_username)
    root = _resolve_impersonated_workspace_root()
    if root is None:
        return None
    return root / cluster_username


def _ensure_impersonated_workspace_dir(cluster_username: str) -> Optional[Path]:
    cluster_username = _normalize_cluster_username(cluster_username)
    workspace_dir = _resolve_impersonated_workspace_dir(cluster_username)
    if workspace_dir is None:
        return None

    workspace_dir.mkdir(parents=True, exist_ok=True)
    service_account = pwd.getpwuid(os.geteuid()).pw_name

    acl_commands = [
        ["setfacl", "-m", f"u:{cluster_username}:rwx", str(workspace_dir)],
        ["setfacl", "-m", f"u:{service_account}:rwx", str(workspace_dir)],
        ["setfacl", "-d", "-m", f"u:{cluster_username}:rwx", str(workspace_dir)],
        ["setfacl", "-d", "-m", f"u:{service_account}:rwx", str(workspace_dir)],
    ]
    for command in acl_commands:
        try:
            subprocess.run(command, text=True, capture_output=True, check=True)
        except FileNotFoundError as exc:
            raise RuntimeError(f"Required ACL command not found: {command[0]}") from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()
            raise RuntimeError(
                f"Failed to prepare workspace {workspace_dir} for {cluster_username}: {stderr or exc}"
            ) from exc

    return workspace_dir


def _get_shared_cache_dirs() -> List[Path]:
    config_dir = getattr(settings, "VEC_INF_CONFIG_DIR", None) or os.getenv("VEC_INF_CONFIG_DIR")
    if not isinstance(config_dir, str) or not config_dir.strip():
        return []

    env_path = Path(config_dir).expanduser() / "environment.yaml"
    if not env_path.exists():
        return []

    try:
        with env_path.open() as file_obj:
            config = yaml.safe_load(file_obj) or {}
    except Exception:
        return []

    bind_value = (((config.get("default_args") or {}).get("bind")) or "").strip()
    if not bind_value:
        return []

    host_dirs: List[Path] = []
    for mount in bind_value.split(","):
        parts = mount.split(":", 1)
        if len(parts) != 2:
            continue
        host_path, container_path = parts
        if container_path not in {"/root/.cache/huggingface", "/root/.cache/torch_inductor"}:
            continue
        host_dirs.append(Path(host_path).expanduser())
    return host_dirs


def _ensure_shared_cache_dir_access(cluster_username: str) -> None:
    cluster_username = _normalize_cluster_username(cluster_username)
    # TODO: Remove this temporary user write access once model cache population is
    # managed manually and launch-time downloads are no longer needed.
    service_account = pwd.getpwuid(os.geteuid()).pw_name
    for cache_dir in _get_shared_cache_dirs():
        cache_dir.mkdir(parents=True, exist_ok=True)
        acl_commands = [
            ["setfacl", "-m", f"u:{cluster_username}:rwx", str(cache_dir)],
            ["setfacl", "-m", f"u:{service_account}:rwx", str(cache_dir)],
            ["setfacl", "-d", "-m", f"u:{cluster_username}:rwx", str(cache_dir)],
            ["setfacl", "-d", "-m", f"u:{service_account}:rwx", str(cache_dir)],
        ]
        for command in acl_commands:
            try:
                subprocess.run(command, text=True, capture_output=True, check=True)
            except FileNotFoundError as exc:
                raise RuntimeError(f"Required ACL command not found: {command[0]}") from exc
            except subprocess.CalledProcessError as exc:
                stderr = (exc.stderr or "").strip()
                raise RuntimeError(
                    f"Failed to prepare shared cache dir {cache_dir} for {cluster_username}: {stderr or exc}"
                ) from exc


def _select_user_slurm_account(cluster_username: str, prefer_gpu: bool = True) -> str:
    cluster_username = _normalize_cluster_username(cluster_username)
    script_path = Path(getattr(settings, "VEC_INF_ACCOUNTS_SCRIPT", "/sw/user/scripts/accounts"))
    if not script_path.exists():
        raise RuntimeError(f"Accounts helper not found: {script_path}")

    result = subprocess.run(
        [str(script_path), "-u", cluster_username],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"Failed to resolve Slurm account for {cluster_username}: {stderr}")

    accounts: List[str] = []
    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("Project Summary for User"):
            continue
        if line.startswith("Account") or set(line) == {"-"}:
            continue
        match = _ACCOUNT_LINE_RE.match(line)
        if match:
            accounts.append(match.group("account"))

    if not accounts:
        raise RuntimeError(f"No Slurm accounts found for {cluster_username}")

    if prefer_gpu:
        for account in accounts:
            if account.lower().endswith("-gpu") or "-gpu-" in account.lower():
                return account

    return accounts[0]


def _get_impersonation_python() -> str:
    configured = getattr(settings, "VEC_INF_IMPERSONATE_PYTHON", None) or os.getenv(
        "VEC_INF_IMPERSONATE_PYTHON"
    )
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    return sys.executable


def _should_inject_project_pythonpath() -> bool:
    configured = getattr(settings, "VEC_INF_IMPERSONATE_PYTHON", None) or os.getenv(
        "VEC_INF_IMPERSONATE_PYTHON"
    )
    return not (isinstance(configured, str) and configured.strip())


class LLMInferenceDirectClient:
    """Direct vec-inf client used both locally and inside the launch shim."""

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

    def get_tunnel_url(
        self,
        job_name: str,
        slurm_job_id: str,
        cluster_username: Optional[str] = None,
    ):
        """Get the Cloudflare tunnel URL for a deployed model (if available)."""
        if cluster_username:
            workspace_dir = _resolve_impersonated_workspace_dir(cluster_username)
            log_base = str(workspace_dir) if workspace_dir else None
        else:
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


class LLMInferenceClient:
    """Launch wrapper that can impersonate the submitting cluster user."""

    def __init__(self):
        self.execution_mode = str(getattr(settings, "VEC_INF_EXECUTION_MODE", "direct") or "direct")
        self.direct_client = LLMInferenceDirectClient()

    @staticmethod
    def _build_launch_payload(
        model_name: str,
        enable_cloudflare_tunnel: bool,
        params: Dict[str, Any],
    ) -> str:
        return json.dumps(
            {
                "model_name": model_name,
                "enable_cloudflare_tunnel": enable_cloudflare_tunnel,
                "params": params,
            }
        )

    @staticmethod
    def _prepend_pythonpath(env: Dict[str, str]) -> Dict[str, str]:
        project_root = str(PROJECT_ROOT)
        pythonpath = env.get("PYTHONPATH")
        if not pythonpath:
            env["PYTHONPATH"] = project_root
        else:
            parts = pythonpath.split(os.pathsep)
            if project_root not in parts:
                env["PYTHONPATH"] = os.pathsep.join([project_root, pythonpath])
        return env

    @staticmethod
    def _parse_impersonated_response(stdout: str, stderr: str) -> Dict[str, Any]:
        for line in reversed([item.strip() for item in stdout.splitlines() if item.strip()]):
            line = _CONTROL_CHARS_RE.sub("", line)
            if "{" in line and "}" in line:
                line = line[line.find("{") : line.rfind("}") + 1]
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed

        error_parts = []
        if stderr.strip():
            error_parts.append(stderr.strip())
        if stdout.strip():
            error_parts.append(stdout.strip())
        error = "\n".join(error_parts) if error_parts else "Impersonated launch returned no JSON payload"
        return {"success": False, "error": error}

    def _launch_model_impersonated(
        self,
        model_name: str,
        enable_cloudflare_tunnel: bool,
        cluster_username: Optional[str],
        **params,
    ):
        if not cluster_username:
            return {
                "success": False,
                "error": "Cluster username is required when impersonation mode is enabled",
            }
        try:
            cluster_username = _normalize_cluster_username(cluster_username)
        except RuntimeError as exc:
            return {"success": False, "error": str(exc)}

        params = dict(params)
        wrapper_path = Path(
            getattr(
                settings,
                "VEC_INF_IMPERSONATE_SCRIPT",
                PROJECT_ROOT / "scripts" / "impersonate-wrapper.py",
            )
        )
        if not wrapper_path.exists():
            return {
                "success": False,
                "error": f"Impersonation wrapper not found: {wrapper_path}",
            }

        try:
            workspace_dir = _ensure_impersonated_workspace_dir(cluster_username)
            _ensure_shared_cache_dir_access(cluster_username)
            if workspace_dir is not None:
                params.setdefault("work_dir", str(workspace_dir))
                params.setdefault("log_dir", str(workspace_dir))

            if not params.get("account"):
                prefer_gpu = params.get("num_gpus", 1) != 0
                params["account"] = _select_user_slurm_account(
                    cluster_username,
                    prefer_gpu=prefer_gpu,
                )
        except RuntimeError as exc:
            return {"success": False, "error": str(exc)}

        payload = self._build_launch_payload(model_name, enable_cloudflare_tunnel, params)
        command = [str(wrapper_path)]
        if not getattr(settings, "VEC_INF_IMPERSONATE_LOGIN_SHELL", True):
            command.append("--no-login-shell")
        command.extend(
            [
                cluster_username,
                "--",
                _get_impersonation_python(),
                "-m",
                "app.utils.vec_inf_launch_shim",
                payload,
            ]
        )

        env = os.environ.copy()
        if _should_inject_project_pythonpath():
            env = self._prepend_pythonpath(env)
        if getattr(settings, "VEC_INF_ENV", None):
            env["VEC_INF_ENV"] = str(settings.VEC_INF_ENV)
        if workspace_dir is not None:
            env["VEC_INF_LOG_DIR"] = str(workspace_dir)
            env["VEC_INF_WORK_DIR"] = str(params.get("work_dir") or workspace_dir)
        if params.get("account"):
            env["VEC_INF_ACCOUNT"] = str(params["account"])
            env["SLURM_ACCOUNT"] = str(params["account"])
        result = subprocess.run(
            command,
            text=True,
            capture_output=True,
            env=env,
            cwd=str(PROJECT_ROOT),
        )

        parsed = self._parse_impersonated_response(result.stdout, result.stderr)
        if result.returncode != 0 and parsed.get("success", True):
            parsed = {
                "success": False,
                "error": parsed.get("error") or f"Impersonated launch failed with code {result.returncode}",
            }
        return parsed

    def launch_model(
        self,
        model_name: str,
        enable_cloudflare_tunnel: bool = False,
        cluster_username: Optional[str] = None,
        **params,
    ):
        if self.execution_mode == "impersonate":
            return self._launch_model_impersonated(
                model_name,
                enable_cloudflare_tunnel=enable_cloudflare_tunnel,
                cluster_username=cluster_username,
                **params,
            )
        return self.direct_client.launch_model(
            model_name,
            enable_cloudflare_tunnel=enable_cloudflare_tunnel,
            **params,
        )

    def get_model_status(self, slurm_job_id: str):
        return self.direct_client.get_model_status(slurm_job_id)

    def get_model_metrics(self, slurm_job_id: str):
        return self.direct_client.get_model_metrics(slurm_job_id)

    def shutdown_model(self, slurm_job_id: str):
        return self.direct_client.shutdown_model(slurm_job_id)

    def list_available_models(self):
        return self.direct_client.list_available_models()

    def get_model_details(self, model_name: str):
        return self.direct_client.get_model_details(model_name)

    def get_tunnel_url(
        self,
        job_name: str,
        slurm_job_id: str,
        cluster_username: Optional[str] = None,
    ):
        return self.direct_client.get_tunnel_url(
            job_name,
            slurm_job_id,
            cluster_username=cluster_username,
        )
