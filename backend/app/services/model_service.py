import concurrent.futures
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config.logging import get_logger
from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment
from app.models.model_request import ModelRequest
from app.schemas.model_deployment import ModelDeploymentCreate, ModelDeploymentUpdate
from app.schemas.model_request import ModelRequestCreate, ModelRequestUpdate
from app.services.resource_service import ResourceService
from app.utils.infrastructure import get_vec_inf_log_base_dir
from app.utils.llm_inference import LLMInferenceClient

logger = get_logger("model_service")


def _infer_model_family_from_model_name(model_name: str) -> str:
    """Legacy heuristic when ``models.yaml`` lookup is unavailable."""
    job = model_name.split("/")[-1] if "/" in model_name else model_name
    if "-" in job:
        return job.split("-", 1)[0]
    return job


TRANSIENT_STATUS_LOOKUP_WINDOW = timedelta(minutes=50)
SLURM_FAILED_JOB_STATES = {
    "FAILED",
    "CANCELLED",
    "TIMEOUT",
    "NODE_FAIL",
    "PREEMPTED",
    "BOOT_FAIL",
    "DEADLINE",
    "OUT_OF_MEMORY",
    "REVOKED",
}


def _parse_slurm_time_to_timedelta(time_value: Any) -> Optional[timedelta]:
    """Parse Slurm time strings (e.g. HH:MM:SS, MM:SS, D-HH:MM:SS)."""
    if not isinstance(time_value, str):
        return None

    raw = time_value.strip()
    if not raw:
        return None

    try:
        days = 0
        clock = raw
        if "-" in raw:
            day_part, clock = raw.split("-", 1)
            days = int(day_part)

        parts = clock.split(":")
        if len(parts) == 3:
            hours, minutes, seconds = map(int, parts)
        elif len(parts) == 2:
            hours = 0
            minutes, seconds = map(int, parts)
        else:
            return None

        return timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)
    except (TypeError, ValueError):
        return None


class ModelService:
    """Service for model management."""

    def __init__(self):
        """Initialize the model service."""
        self.llm_client = LLMInferenceClient()
        # Maximum number of workers for parallel processing
        self.max_workers = 10

    # Model Request Functions
    def create_model_request(
        self, db: Session, request: ModelRequestCreate
    ) -> ModelRequest:
        """Create a new model request."""
        db_request = ModelRequest(
            userId=request.userId,
            name=request.name,
            email=request.email,
            department=request.department,
            modelType=request.modelType,
            purpose=request.purpose,
            startDate=request.startDate,
            endDate=request.endDate,
            resourceRequirements=request.resourceRequirements,
            status="pending",
        )
        db.add(db_request)
        db.commit()
        db.refresh(db_request)
        return db_request

    def get_model_request(
        self, db: Session, request_id: UUID
    ) -> Optional[ModelRequest]:
        """Get a model request by ID."""
        return db.query(ModelRequest).filter(ModelRequest.id == request_id).first()

    def get_model_requests(
        self,
        db: Session,
        user_id: Optional[UUID] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ModelRequest]:
        """Get model requests with optional filters."""
        query = db.query(ModelRequest)

        if user_id:
            query = query.filter(ModelRequest.userId == user_id)

        if status:
            query = query.filter(ModelRequest.status == status)

        return (
            query.order_by(ModelRequest.createdAt.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def update_model_request(
        self, db: Session, request_id: UUID, request_update: ModelRequestUpdate
    ) -> Optional[ModelRequest]:
        """Update a model request."""
        db_request = self.get_model_request(db, request_id)
        if not db_request:
            return None

        update_data = request_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_request, key, value)

        db_request.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_request)
        return db_request

    # Model Deployment Functions
    def launch_model(
        self, db: Session, deployment: ModelDeploymentCreate
    ) -> ModelDeployment:
        """Launch a model and create a deployment record."""
        # Extract parameters for the launch command
        params = deployment.model_dump(exclude={"modelName", "modelId", "userId"})
        model_id = deployment.modelId or deployment.modelName

        # Get the enable_cloudflare_tunnel parameter
        enable_cloudflare_tunnel = params.pop("enable_cloudflare_tunnel", False)
        resource_allocation = {
            **params,
            "enable_cloudflare_tunnel": enable_cloudflare_tunnel,
        }

        # Check and allocate resources if needed
        resource_service = ResourceService()

        # Get the number of GPUs requested
        num_gpus = params.get("num_gpus")
        num_nodes = params.get("num_nodes", 1)

        # If GPU resources are requested, check availability and allocate
        if num_gpus:
            # Calculate total GPUs needed
            total_gpus = num_gpus * num_nodes

            # Try to allocate GPU resources
            # Note: We're using a generic "GPU" resource type here
            # In a real system, you might want to be more specific (e.g., "A100", "V100")
            allocation_result = resource_service.allocate_resources(
                db=db, resource_type="GPU", resource_name="default", count=total_gpus
            )

            if not allocation_result.get("success", False):
                # Failed to allocate resources
                db_deployment = ModelDeployment(
                    modelId=model_id,
                    modelName=deployment.modelName,
                    userId=deployment.userId,
                    slurmJobId="failed",
                    status="failed",
                    errorMessage=allocation_result.get(
                        "error", "Failed to allocate GPU resources"
                    ),
                    resourceAllocation=resource_allocation,
                )
                db.add(db_deployment)
                db.commit()
                db.refresh(db_deployment)
                return db_deployment

            logger.info(
                f"Allocated {total_gpus} GPU resources for model {deployment.modelName}"
            )

        # Launch the model
        logger.info(
            "Launching model=%s user_id=%s partition=%s resource_type=%s num_nodes=%s num_gpus=%s time=%s",
            deployment.modelName,
            deployment.userId,
            params.get("partition"),
            params.get("resource_type"),
            params.get("num_nodes"),
            params.get("num_gpus"),
            params.get("time"),
        )
        result = self.llm_client.launch_model(
            deployment.modelName,
            enable_cloudflare_tunnel=enable_cloudflare_tunnel,
            **params,
        )

        if not result.get("success", False):
            # Release allocated resources if launch failed
            if num_gpus:
                resource_service.release_resources(
                    db=db,
                    resource_type="GPU",
                    resource_name="default",
                    count=total_gpus,
                )

            # Create a failed deployment record
            db_deployment = ModelDeployment(
                modelId=model_id,
                modelName=deployment.modelName,
                userId=deployment.userId,
                slurmJobId="failed",
                status="failed",
                errorMessage=result.get("error", "Unknown error"),
                resourceAllocation=resource_allocation,
            )
            db.add(db_deployment)
            db.commit()
            db.refresh(db_deployment)
            return db_deployment

        # Extract the Slurm job ID from the result (support multiple keys)
        slurm_job_id: Optional[str] = result.get("job_id") or result.get("slurm_job_id")
        # vec-inf sometimes emits a trailing "\nAccount:" due to environment prompts; sanitize
        if isinstance(slurm_job_id, str):
            slurm_job_id = slurm_job_id.strip()
            # Remove any trailing fragments after a newline
            if "\n" in slurm_job_id:
                slurm_job_id = slurm_job_id.split("\n", 1)[0].strip()
        if not slurm_job_id:
            # Release allocated resources if launch failed
            if num_gpus:
                resource_service.release_resources(
                    db=db,
                    resource_type="GPU",
                    resource_name="default",
                    count=total_gpus,
                )

            # Create a failed deployment record
            db_deployment = ModelDeployment(
                modelId=model_id,
                modelName=deployment.modelName,
                userId=deployment.userId,
                slurmJobId="failed",
                status="failed",
                errorMessage="Failed to get Slurm job ID",
                resourceAllocation=resource_allocation,
            )
            db.add(db_deployment)
            db.commit()
            db.refresh(db_deployment)
            return db_deployment

        # Create a deployment record
        db_deployment = ModelDeployment(
            modelId=model_id,
            modelName=deployment.modelName,
            userId=deployment.userId,
            slurmJobId=slurm_job_id,
            status="pending",
            resourceAllocation=resource_allocation,
            # Expiration is set when deployment becomes ready, so queued time
            # does not consume model lifetime.
            expiresAt=None,
        )
        db.add(db_deployment)
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def get_deployment(
        self, db: Session, deployment_id: UUID
    ) -> Optional[ModelDeployment]:
        """Get a model deployment by ID."""
        return (
            db.query(ModelDeployment)
            .filter(ModelDeployment.id == deployment_id)
            .first()
        )

    def get_model_family(self, db: Session, model_id: str) -> Optional[str]:
        """Get the model family from the model id."""
        model = db.query(AvailableModel).filter(AvailableModel.id == model_id).first()
        return model.family if model is not None else None

    def get_deployment_by_job_id(
        self, db: Session, slurm_job_id: str
    ) -> Optional[ModelDeployment]:
        """Get a model deployment by Slurm job ID."""
        return (
            db.query(ModelDeployment)
            .filter(ModelDeployment.slurmJobId == slurm_job_id)
            .first()
        )

    def get_deployments(
        self,
        db: Session,
        user_id: Optional[UUID] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ModelDeployment]:
        """Get model deployments with optional filters."""
        logger.info(
            f"Getting deployments with user_id: {user_id}, status: {status}, skip: {skip}, limit: {limit}"
        )
        query = db.query(ModelDeployment)

        if user_id:
            query = query.filter(ModelDeployment.userId == user_id)

        if status:
            query = query.filter(ModelDeployment.status == status)

        deployments = (
            query.order_by(ModelDeployment.createdAt.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

        # Keep statuses fresh for UI lists. This avoids stale "failed" rows
        # when Slurm status calls had transient errors immediately after launch.
        for deployment in deployments:
            self.update_deployment_status(db=db, deployment_id=deployment.id)

        return deployments

    def update_deployment(
        self, db: Session, deployment_id: UUID, deployment_update: ModelDeploymentUpdate
    ) -> Optional[ModelDeployment]:
        """Update a model deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None

        update_data = deployment_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_deployment, key, value)

        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def update_deployment_status(
        self, db: Session, deployment_id: UUID
    ) -> Optional[ModelDeployment]:
        """Update the status of a model deployment by checking with llm-inference."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None

        # Skip if the deployment is already in a terminal state, except for
        # transient Slurm lookup failures that can recover shortly after launch.
        if db_deployment.status in ["shutdown", "completed"]:
            return db_deployment
        if db_deployment.status == "failed":
            err = (db_deployment.errorMessage or "").lower()
            transient_failure = (
                "invalid job id specified" in err
                or "slurm_load_jobs" in err
                or "permission denied" in err
                or "errno 13" in err
            )
            if not transient_failure:
                return db_deployment

            # Allow recovery for transient status lookup failures in a short window.
            age = datetime.utcnow() - db_deployment.createdAt
            if age > TRANSIENT_STATUS_LOOKUP_WINDOW:
                return db_deployment

            logger.info(
                "Retrying status refresh for transient failed deployment id=%s slurm_job_id=%s",
                deployment_id,
                db_deployment.slurmJobId,
            )

            # Move back to launching before retrying status checks.
            db_deployment.status = "launching"
            db_deployment.errorMessage = None
            db_deployment.updatedAt = datetime.utcnow()
            db.commit()
            db.refresh(db_deployment)

        # Get the current status from llm-inference
        result = self.llm_client.get_model_status(db_deployment.slurmJobId)

        if not result.get("success", False):
            err_msg = result.get("error", "Failed to get status")
            err_lower = str(err_msg).lower()
            age = datetime.utcnow() - db_deployment.createdAt
            transient_lookup = (
                "invalid job id specified" in err_lower
                or "slurm_load_jobs" in err_lower
                or "permission denied" in err_lower
                or "errno 13" in err_lower
            )

            if transient_lookup:
                slurm_state = self._get_slurm_state_from_sacct(db_deployment.slurmJobId)
                if slurm_state:
                    normalized_state = self._normalize_slurm_state(slurm_state)
                    if normalized_state == "COMPLETED":
                        db_deployment.status = "completed"
                        db_deployment.errorMessage = None
                    elif normalized_state in SLURM_FAILED_JOB_STATES:
                        db_deployment.status = "failed"
                        db_deployment.errorMessage = f"Slurm job {slurm_state.lower()}"
                    elif normalized_state == "PENDING":
                        db_deployment.status = "pending"
                    elif normalized_state == "RUNNING":
                        db_deployment.status = "running"
                    else:
                        db_deployment.status = "launching"
                    db_deployment.updatedAt = datetime.utcnow()
                    db.commit()
                    db.refresh(db_deployment)
                    return db_deployment

            # Newly launched jobs can transiently fail status lookup while Slurm state
            # propagates. Keep them launching and retry on later polls.
            if transient_lookup and age <= TRANSIENT_STATUS_LOOKUP_WINDOW:
                db_deployment.status = "launching"
                db_deployment.errorMessage = None
            else:
                db_deployment.status = "failed"
                db_deployment.errorMessage = err_msg
            db_deployment.updatedAt = datetime.utcnow()
            db.commit()
            db.refresh(db_deployment)
            return db_deployment

        # Extract the status from the result
        status = (result.get("status") or "unknown").upper()
        job_state = result.get("job_state")

        # Map vec-inf server status -> our deployment status.
        if status == "READY":
            db_deployment.status = "ready"
            db_deployment.endpointUrl = result.get("endpoint_url")
            requested_time = None
            if isinstance(db_deployment.resourceAllocation, dict):
                requested_time = db_deployment.resourceAllocation.get("time")
            requested_duration = _parse_slurm_time_to_timedelta(requested_time)

            if requested_duration:
                now = datetime.utcnow()
                # Set TTL from ready time. Also repair stale pre-ready expirations.
                if db_deployment.expiresAt is None or db_deployment.expiresAt <= now:
                    db_deployment.expiresAt = now + requested_duration
                    logger.info(
                        "Set expiresAt=%s from ready time for deployment id=%s job=%s",
                        db_deployment.expiresAt,
                        db_deployment.id,
                        db_deployment.slurmJobId,
                    )
        elif status == "PENDING":
            db_deployment.status = "pending"
        elif status == "LAUNCHING":
            db_deployment.status = "launching"
        elif status == "RUNNING":
            db_deployment.status = "running"
        elif status == "FAILED":
            db_deployment.status = "failed"
            db_deployment.errorMessage = result.get("failed_reason") or "Job failed"
        elif status == "SHUTDOWN":
            db_deployment.status = "shutdown"

        # If Slurm reports a terminal job state, prefer that terminal state.
        normalized_job_state = self._normalize_slurm_state(job_state)
        if normalized_job_state == "COMPLETED":
            db_deployment.status = "completed"
            db_deployment.errorMessage = None
        elif normalized_job_state in SLURM_FAILED_JOB_STATES:
            db_deployment.status = "failed"
            db_deployment.errorMessage = (
                result.get("failed_reason")
                or f"Slurm job {normalized_job_state.lower()}"
            )

        # Try to get the tunnel URL if Cloudflare tunnel was enabled
        if (
            db_deployment.status == "ready"
            and db_deployment.resourceAllocation
            and db_deployment.resourceAllocation.get("enable_cloudflare_tunnel")
        ):
            job_name = db_deployment.modelName.replace("/", "-")
            tunnel_url = self.llm_client.get_tunnel_url(
                job_name, db_deployment.slurmJobId
            )
            if tunnel_url:
                db_deployment.proxyUrl = tunnel_url

        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def _normalize_slurm_state(self, state: Any) -> str:
        """Normalize Slurm state strings (e.g., 'CANCELLED by 1234' -> 'CANCELLED')."""
        if not isinstance(state, str):
            return ""
        normalized = state.strip().upper()
        if not normalized:
            return ""
        # States may include suffixes/details such as '+', or "by <uid>".
        normalized = normalized.split("+", 1)[0].split(" ", 1)[0]
        return normalized

    def _get_slurm_state_from_sacct(self, slurm_job_id: str) -> Optional[str]:
        """Fallback lookup for terminal status when scontrol no longer has the job."""
        if not slurm_job_id:
            return None
        try:
            proc = subprocess.run(
                [
                    "sacct",
                    "-j",
                    str(slurm_job_id),
                    "--format=JobIDRaw,State",
                    "--noheader",
                    "-P",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                return None
            for line in proc.stdout.splitlines():
                if not line.strip():
                    continue
                parts = line.split("|")
                if len(parts) < 2:
                    continue
                job_id_raw = parts[0].strip()
                state = parts[1].strip()
                # Prefer the top-level row for exact job id; skip .batch/.extern rows.
                if job_id_raw == str(slurm_job_id) and state:
                    return state
            return None
        except Exception as e:
            logger.warning(
                "sacct fallback status lookup failed for slurm_job_id=%s: %s",
                slurm_job_id,
                e,
            )
            return None

    def shutdown_deployment(
        self, db: Session, deployment_id: UUID
    ) -> Optional[ModelDeployment]:
        """Shutdown a model deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None

        # Skip if the deployment is already in a terminal state
        if db_deployment.status in ["failed", "shutdown", "completed"]:
            return db_deployment

        # Shutdown the model
        self.llm_client.shutdown_model(db_deployment.slurmJobId)

        # Update the deployment status
        db_deployment.status = "shutdown"
        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)

        # Release allocated resources
        resource_service = ResourceService()

        # Check if the deployment has resource allocation information
        if db_deployment.resourceAllocation:
            num_gpus = db_deployment.resourceAllocation.get("num_gpus")
            num_nodes = db_deployment.resourceAllocation.get("num_nodes", 1)

            # If GPU resources were allocated, release them
            if num_gpus:
                # Calculate total GPUs to release
                total_gpus = num_gpus * num_nodes

                # Release GPU resources
                release_result = resource_service.release_resources(
                    db=db,
                    resource_type="GPU",
                    resource_name="default",
                    count=total_gpus,
                )

                if release_result.get("success", False):
                    logger.info(
                        f"Released {total_gpus} GPU resources from deployment {deployment_id}"
                    )
                else:
                    logger.error(
                        f"Failed to release GPU resources from deployment {deployment_id}: {release_result.get('error')}"
                    )

        return db_deployment

    def list_available_models(self) -> Dict[str, Any]:
        """List available models using llm-inference."""
        return self.llm_client.list_available_models()

    def get_model_details(self, model_name: str) -> Dict[str, Any]:
        """Get details of a specific model using llm-inference."""
        return self.llm_client.get_model_details(model_name)

    def get_deployment_metrics(
        self, deployment_id: UUID, db: Session
    ) -> Dict[str, Any]:
        """Get metrics for a model deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return {"success": False, "error": "Deployment not found"}

        # Skip if the deployment is not ready
        if db_deployment.status != "ready":
            return {
                "success": False,
                "error": f"Deployment is not ready (status: {db_deployment.status})",
            }

        # Get the metrics from llm-inference
        return self.llm_client.get_model_metrics(db_deployment.slurmJobId)

    def get_deployment_logs(
        self, db: Session, deployment_id: UUID, tail: int = 100
    ) -> Dict[str, Any]:
        """Get logs for a model deployment from the Slurm log directory.

        Args:
            db: Database session
            deployment_id: ID of the deployment
            tail: Number of lines to return from the end (0 for all lines)

        Returns:
            Dictionary with success status, logs, and deployment info
        """
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return {"success": False, "error": "Deployment not found"}

        # Keep status fresh for log polling views (e.g., logs panel pill state).
        refreshed = self.update_deployment_status(db=db, deployment_id=deployment_id)
        if refreshed:
            db_deployment = refreshed

        # Get the log directory from the llm_client
        log_base = get_vec_inf_log_base_dir()
        if not log_base:
            return {
                "success": False,
                "error": "Vec-inf log directory not configured",
                "deployment": {
                    "id": str(db_deployment.id),
                    "status": db_deployment.status,
                    "modelName": db_deployment.modelName,
                },
            }

        model_id = db_deployment.modelId
        slurm_job_id = db_deployment.slurmJobId

        model_family = self.get_model_family(db, model_id)
        # Raise error if model_family is None
        if not model_family:
            return {
                "success": False,
                "error": f"Model family not found for model {model_id}",
                "deployment": {
                    "id": str(db_deployment.id),
                    "status": db_deployment.status,
                    "modelName": db_deployment.modelName,
                },
            }
        job_dir = Path(log_base) / model_family / f"{model_id}.{slurm_job_id}"

        log_files = {
            "err": job_dir / f"{model_id}.{slurm_job_id}.err",
            "out": job_dir / f"{model_id}.{slurm_job_id}.out",
        }

        logs = {
            "stderr": [],
            "stdout": [],
        }

        # Read log files
        for log_type, file_path in log_files.items():
            try:
                if file_path.exists():
                    with open(file_path, "r") as f:
                        lines = f.readlines()
                        # Apply tail if specified
                        if tail > 0 and len(lines) > tail:
                            lines = lines[-tail:]
                        # Clean up lines
                        log_key = "stderr" if log_type == "err" else "stdout"
                        logs[log_key] = [line.rstrip("\n") for line in lines]
                else:
                    logger.debug(f"Log file not found: {file_path}")
            except Exception as e:
                logger.error(f"Error reading log file {file_path}: {e}")
                logs["stderr" if log_type == "err" else "stdout"] = [
                    f"Error reading log: {str(e)}"
                ]

        return {
            "success": True,
            "logs": logs,
            "deployment": {
                "id": str(db_deployment.id),
                "status": db_deployment.status,
                "modelName": db_deployment.modelName,
                "slurmJobId": db_deployment.slurmJobId,
                "errorMessage": db_deployment.errorMessage,
            },
            "logFiles": {
                "stderr": str(log_files["err"]),
                "stdout": str(log_files["out"]),
            },
        }

    def extend_deployment_expiration(
        self, db: Session, deployment_id: UUID, extension_hours: int
    ) -> Optional[ModelDeployment]:
        """Extend the expiration time of a deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None

        # Only allow extending active deployments
        if db_deployment.status not in ["launching", "running", "ready"]:
            logger.warning(
                f"Cannot extend deployment {deployment_id} with status {db_deployment.status}"
            )
            return db_deployment

        # Calculate new expiration time
        # If there's no existing expiration time, set it from now
        if not db_deployment.expiresAt:
            db_deployment.expiresAt = datetime.utcnow()

        # Add the extension hours
        db_deployment.expiresAt += timedelta(hours=extension_hours)

        logger.info(
            f"Extended expiration time for deployment {deployment_id} to {db_deployment.expiresAt}"
        )

        # Update the deployment
        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)

        return db_deployment

    def get_model_size(self, gpu_count: int) -> str:
        """Determine model size based on GPU count."""
        if gpu_count <= 1:
            return "Small"
        if gpu_count <= 2:
            return "Medium"
        return "Large"

    def format_model_name(self, model_id: str) -> str:
        """Format model name for display."""
        # Remove common prefixes and format nicely
        return " ".join(
            word.capitalize() for word in model_id.replace("-", " ").split()
        )

    def generate_model_description(
        self, name: str, family: str, context_length: int
    ) -> str:
        """Generate a description based on model name and specs."""
        descriptions = {
            "c4ai-command-r": "High-performance model optimized for academic research and analysis",
            "llama": "Open-source model suitable for various NLP tasks",
            "mistral": "Efficient open-source model with strong reasoning capabilities",
            "mixtral": "Mixture-of-experts model with advanced reasoning and instruction following",
            "phi": "Compact and efficient model with strong reasoning capabilities",
            "gemma": "Google's lightweight open model for various text generation tasks",
            "codellama": "Specialized model for code understanding and generation",
            "claude": "High-performance model optimized for academic research and analysis",
            "gpt": "Advanced model for language understanding and generation",
        }

        # Find the matching family prefix
        matching_family = None
        for key in descriptions:
            if key.lower() in family.lower() or key.lower() in name.lower():
                matching_family = key
                break

        if matching_family:
            return descriptions[matching_family]

        # Default description based on context length
        if context_length > 32000:
            return f"Advanced model with {context_length:,} token context window for complex tasks"
        elif context_length > 8000:
            return f"Versatile model with {context_length:,} token context for various applications"
        else:
            return "Efficient model optimized for performance and reliability"

    def get_detailed_models(self) -> List[Dict[str, Any]]:
        """Get detailed information about all available models."""
        result = self.llm_client.list_available_models()
        if not result.get("success", False):
            logger.error(
                f"Failed to get detailed models: {result.get('error', 'Unknown error')}"
            )
            return []

        # Get list of model names
        model_names = result.get("models", [])
        if not isinstance(model_names, list):
            logger.error(f"Expected list of model names, got {type(model_names)}")
            return []

        # Fetch detailed information for each model
        detailed_models = []
        for model_name in model_names:
            # Handle both string model names and dict/model objects
            if isinstance(model_name, str):
                # Fetch model details
                details_result = self.llm_client.get_model_details(model_name)
                if details_result.get("success", False):
                    model_config = details_result.get("details", {})
                    # Convert model config to expected format
                    # Handle both dict and object formats
                    if isinstance(model_config, dict):
                        model_dict = model_config
                    elif hasattr(model_config, "__dict__"):
                        # Object with __dict__, convert to dict
                        model_dict = model_config.__dict__.copy()
                    else:
                        # Try to access as attributes and convert to dict
                        model_dict = {}
                        for attr in [
                            "model_family",
                            "model_variant",
                            "model_type",
                            "gpus_per_node",
                            "num_gpus",
                            "num_nodes",
                            "vocab_size",
                            "huggingface_id",
                            "vllm_args",
                            "max_model_len",
                            "pipeline_parallelism",
                        ]:
                            if hasattr(model_config, attr):
                                model_dict[attr] = getattr(model_config, attr)

                    # Helper to get value from dict or object
                    def get_value(key, default=None):
                        if key in model_dict:
                            return model_dict[key]
                        if not isinstance(model_config, dict) and hasattr(
                            model_config, key
                        ):
                            return getattr(model_config, key)
                        return default

                    # Extract fields and normalize names
                    # Check if max_model_len and pipeline_parallelism are already extracted
                    max_model_len = get_value("max_model_len")
                    if not max_model_len:
                        max_model_len = self._extract_max_model_len(
                            model_dict, model_config
                        )

                    pipeline_parallelism = get_value("pipeline_parallelism")
                    if pipeline_parallelism is None:
                        pipeline_parallelism = self._extract_pipeline_parallelism(
                            model_dict, model_config
                        )

                    model_data = {
                        "model_name": model_name,
                        "model_family": get_value("model_family", ""),
                        "model_variant": get_value("model_variant", ""),
                        "model_type": get_value("model_type", "LLM"),
                        "num_gpus": get_value("gpus_per_node")
                        or get_value("num_gpus", 1),
                        "num_nodes": get_value("num_nodes", 1),
                        "max_model_len": max_model_len,
                        "pipeline_parallelism": pipeline_parallelism,
                        "vocab_size": get_value("vocab_size"),
                        "huggingface_id": get_value("huggingface_id"),
                    }
                    detailed_models.append(model_data)
                else:
                    logger.warning(
                        f"Failed to get details for model {model_name}: {details_result.get('error', 'Unknown error')}"
                    )
            elif isinstance(model_name, dict):
                # Already a dict, use as-is
                detailed_models.append(model_name)
            else:
                logger.warning(f"Unexpected model format: {type(model_name)}")

        return detailed_models

    def _extract_max_model_len(
        self, model_dict: Dict[str, Any], model_config: Any = None
    ) -> int:
        """Extract max_model_len from vllm_args or model config."""
        # Check vllm_args
        vllm_args = model_dict.get("vllm_args", {})
        if not vllm_args and model_config and not isinstance(model_config, dict):
            vllm_args = getattr(model_config, "vllm_args", {})

        if isinstance(vllm_args, dict):
            max_len = vllm_args.get("--max-model-len")
            if max_len:
                return int(max_len)
        elif isinstance(vllm_args, str):
            # Parse from string format
            if "--max-model-len" in vllm_args:
                parts = vllm_args.split("--max-model-len")
                if len(parts) > 1:
                    try:
                        return int(parts[1].split()[0])
                    except (ValueError, IndexError):
                        pass

        # Check direct field
        max_len = model_dict.get("max_model_len")
        if max_len:
            return int(max_len)
        if model_config and not isinstance(model_config, dict):
            max_len = getattr(model_config, "max_model_len", None)
            if max_len:
                return int(max_len)

        return 4096

    def _extract_pipeline_parallelism(
        self, model_dict: Dict[str, Any], model_config: Any = None
    ) -> bool:
        """Extract pipeline_parallelism from vllm_args or model config."""
        # Check vllm_args
        vllm_args = model_dict.get("vllm_args", {})
        if not vllm_args and model_config and not isinstance(model_config, dict):
            vllm_args = getattr(model_config, "vllm_args", {})

        if isinstance(vllm_args, dict):
            pipeline_size = vllm_args.get("--pipeline-parallel-size")
            if pipeline_size:
                return int(pipeline_size) > 1
        elif isinstance(vllm_args, str):
            # Parse from string format
            if "--pipeline-parallel-size" in vllm_args:
                parts = vllm_args.split("--pipeline-parallel-size")
                if len(parts) > 1:
                    try:
                        return int(parts[1].split()[0]) > 1
                    except (ValueError, IndexError):
                        pass

        # Check direct field
        pipeline_parallelism = model_dict.get("pipeline_parallelism")
        if pipeline_parallelism is not None:
            return bool(pipeline_parallelism)
        if model_config and not isinstance(model_config, dict):
            pipeline_parallelism = getattr(model_config, "pipeline_parallelism", None)
            if pipeline_parallelism is not None:
                return bool(pipeline_parallelism)

        return False

    def _process_model(
        self,
        model_data: Dict[str, Any],
        existing_model: Optional[AvailableModel] = None,
    ) -> Dict[str, Any]:
        """Process a single model and prepare it for database operation.

        Args:
            model_data: The model data from vec-inf
            existing_model: The existing model from the database, if any

        Returns:
            A dictionary with the processed model data and operation status
        """
        model_id = model_data.get("model_name", "")
        if not model_id:
            return {"status": "skipped", "reason": "missing_id"}

        # Extract model information
        model_family = model_data.get("model_family", "")
        # Ensure variant is never NULL for the database NOT NULL constraint
        model_variant = model_data.get("model_variant") or ""
        model_type = model_data.get("model_type", "LLM")
        num_gpus = model_data.get("num_gpus", 1)
        num_nodes = model_data.get("num_nodes", 1)
        max_model_len = model_data.get("max_model_len", 4096)
        pipeline_parallelism = model_data.get("pipeline_parallelism", False)
        vocab_size = model_data.get("vocab_size")
        huggingface_id = model_data.get("huggingface_id")

        # Create model specs
        specs = {
            "gpus": num_gpus,
            "nodes": num_nodes,
            "contextLength": max_model_len,
            "parallelism": pipeline_parallelism,
        }

        # Determine model size
        model_size = self.get_model_size(num_gpus)

        # Common model attributes
        model_attrs = {
            "id": model_id,
            "name": self.format_model_name(model_id),
            "description": self.generate_model_description(
                model_id, model_family, max_model_len
            ),
            "status": "WARM",
            "type": model_size,
            "family": model_family,
            "variant": model_variant,
            "modelType": model_type,
            "specs": specs,
            "vocabSize": vocab_size,
            "huggingfaceId": huggingface_id,
        }

        # Check if model exists and needs update
        if existing_model:
            # Check if model needs to be updated
            needs_update = (
                existing_model.family != model_family
                or existing_model.variant != model_variant
                or existing_model.modelType != model_type
                or existing_model.type != model_size
                or existing_model.vocabSize != vocab_size
                or existing_model.huggingfaceId != huggingface_id
                or existing_model.specs != specs
            )

            if needs_update:
                return {"status": "update", "model_id": model_id, "attrs": model_attrs}
            else:
                return {"status": "unchanged", "model_id": model_id}
        else:
            return {"status": "create", "model_id": model_id, "attrs": model_attrs}

    def sync_available_models(self, db: Session) -> Dict[str, Any]:
        """Sync available models with the database using parallel processing."""
        try:
            # Get detailed model information
            models = self.get_detailed_models()

            if not models:
                return {"success": False, "error": "No models found"}

            # Get existing models from database
            existing_models = {
                model.id: model for model in db.query(AvailableModel).all()
            }

            # Track statistics
            added_count = 0
            updated_count = 0
            unchanged_count = 0
            removed_count = 0

            # Process models in parallel
            results = []
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=self.max_workers
            ) as executor:
                # Submit all tasks
                future_to_model = {
                    executor.submit(
                        self._process_model,
                        model_data,
                        existing_models.get(model_data.get("model_name", "")),
                    ): model_data
                    for model_data in models
                }

                # Process results as they complete
                for future in concurrent.futures.as_completed(future_to_model):
                    try:
                        result = future.result()
                        results.append(result)
                    except Exception as exc:
                        model_data = future_to_model[future]
                        model_id = model_data.get("model_name", "unknown")
                        logger.error(f"Model {model_id} generated an exception: {exc}")

            # Apply database changes in a single transaction
            for result in results:
                status = result.get("status")

                if status == "create":
                    # Create new model
                    attrs = result.get("attrs", {})
                    db_model = AvailableModel(**attrs)
                    db.add(db_model)
                    added_count += 1

                elif status == "update":
                    # Update existing model
                    model_id = result.get("model_id")
                    attrs = result.get("attrs", {})

                    existing_model = existing_models[model_id]
                    for key, value in attrs.items():
                        setattr(existing_model, key, value)

                    existing_model.updatedAt = datetime.utcnow()
                    updated_count += 1

                elif status == "unchanged":
                    unchanged_count += 1

            # Remove models that are no longer in the current YAML
            synced_model_ids = {
                m.get("model_name") for m in models if m.get("model_name")
            }
            stale_ids = set(existing_models.keys()) - synced_model_ids
            # Check rows did not exist in ModelDeployment table to avoid orphaned rows
            if stale_ids:
                referenced_ids = {
                    row[0] for row in db.query(ModelDeployment.modelId).distinct().all()
                }
                stale_ids -= referenced_ids
            if stale_ids:
                db.execute(
                    delete(AvailableModel).where(AvailableModel.id.in_(stale_ids))
                )
                removed_count = len(stale_ids)
                logger.info(f"Removed {removed_count} stale models: {stale_ids}")

            # Commit changes
            db.commit()

            return {
                "success": True,
                "message": f"Successfully synced models: {added_count} added, {updated_count} updated, {unchanged_count} unchanged, {removed_count} removed",
                "count": len(models),
                "added": added_count,
                "updated": updated_count,
                "unchanged": unchanged_count,
                "removed": removed_count,
            }
        except Exception as e:
            db.rollback()
            logger.error(f"Error syncing models: {str(e)}")
            return {"success": False, "error": str(e)}
