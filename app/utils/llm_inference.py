import json
import subprocess
import os
from typing import Dict, List, Optional, Any, Union

from app.config.logging import get_logger
from app.config.config import settings

logger = get_logger("llm_inference")


class LLMInferenceClient:
    """Client for interacting with the llm-inference package."""

    def __init__(self):
        """Initialize the LLM inference client."""
        self.slurm_log_dir = settings.SLURM_LOG_DIR
        self.slurm_account = settings.SLURM_ACCOUNT

    def run_command(self, command: List[str]) -> Dict[str, Any]:
        """Run a command and return the output."""
        try:
            logger.info(f"Running command: {' '.join(command)}")
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=True
            )
            
            # Try to parse the output as JSON
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return {"success": True, "output": result.stdout}
                
        except subprocess.CalledProcessError as e:
            logger.error(f"Command failed with exit code {e.returncode}: {e.stderr}")
            return {"success": False, "error": e.stderr}

    def launch_model(
        self,
        model_name: str,
        enable_cloudflare_tunnel: bool = False,
        **params: Optional[Union[str, int, bool]]
    ) -> Dict[str, Any]:
        """Launch a model using the llm-inference package."""
        command = ["vec-inf", "launch", model_name, "--json-mode"]
        
        # Add Cloudflare tunnel flag if enabled
        if enable_cloudflare_tunnel:
            command.append("--enable-cloudflare-tunnel")
        
        # Add the SLURM account parameter if not already provided and available in settings
        if "account" not in params and self.slurm_account:
            params["account"] = self.slurm_account
            logger.info(f"Using SLURM account from environment: {self.slurm_account}")
        
        # Add optional parameters
        for key, value in params.items():
            if value is not None and key != "enable_cloudflare_tunnel":
                command.extend([f"--{key.replace('_', '-')}", str(value)])
        
        return self.run_command(command)

    def get_model_status(self, slurm_job_id: str) -> Dict[str, Any]:
        """Get the status of a model using the llm-inference package."""
        command = ["vec-inf", "status", slurm_job_id, "--json-mode"]
        
        # Add log directory if specified
        if self.slurm_log_dir:
            command.extend(["--log-dir", self.slurm_log_dir])
        
        return self.run_command(command)

    def get_model_metrics(self, slurm_job_id: str) -> Dict[str, Any]:
        """Get metrics for a model using the llm-inference package."""
        command = ["vec-inf", "metrics", slurm_job_id]
        
        # Add log directory if specified
        if self.slurm_log_dir:
            command.extend(["--log-dir", self.slurm_log_dir])
        
        return self.run_command(command)

    def shutdown_model(self, slurm_job_id: str) -> Dict[str, Any]:
        """Shutdown a model using the llm-inference package."""
        command = ["vec-inf", "shutdown", slurm_job_id]
        return self.run_command(command)

    def list_available_models(self) -> Dict[str, Any]:
        """List available models using the llm-inference package."""
        command = ["vec-inf", "list", "--json-mode"]
        return self.run_command(command)

    def get_model_details(self, model_name: str) -> Dict[str, Any]:
        """Get details of a specific model using the llm-inference package."""
        command = ["vec-inf", "list", model_name, "--json-mode"]
        return self.run_command(command)
        
    def get_tunnel_url(self, job_name: str, slurm_job_id: str) -> Optional[str]:
        """Get the Cloudflare tunnel URL for a deployed model.
        
        Args:
            job_name: The name of the job (model family-variant)
            slurm_job_id: The Slurm job ID
            
        Returns:
            The tunnel URL if found, None otherwise
        """
        if not self.slurm_log_dir:
            logger.error("Slurm log directory not specified")
            return None
            
        # Construct the path to the tunnel URL file
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