from datetime import datetime
from typing import Dict, List, Optional, Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.model_deployment import ModelDeployment
from app.models.model_request import ModelRequest
from app.schemas.model_deployment import ModelDeploymentCreate, ModelDeploymentUpdate
from app.schemas.model_request import ModelRequestCreate, ModelRequestUpdate
from app.utils.llm_inference import LLMInferenceClient
from app.config.logging import get_logger

logger = get_logger("model_service")


class ModelService:
    """Service for model management."""

    def __init__(self):
        """Initialize the model service."""
        self.llm_client = LLMInferenceClient()

    # Model Request Functions
    def create_model_request(self, db: Session, request: ModelRequestCreate) -> ModelRequest:
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
            status="pending"
        )
        db.add(db_request)
        db.commit()
        db.refresh(db_request)
        return db_request

    def get_model_request(self, db: Session, request_id: UUID) -> Optional[ModelRequest]:
        """Get a model request by ID."""
        return db.query(ModelRequest).filter(ModelRequest.id == request_id).first()

    def get_model_requests(
        self,
        db: Session, 
        user_id: Optional[UUID] = None,
        status: Optional[str] = None,
        skip: int = 0, 
        limit: int = 100
    ) -> List[ModelRequest]:
        """Get model requests with optional filters."""
        query = db.query(ModelRequest)
        
        if user_id:
            query = query.filter(ModelRequest.userId == user_id)
        
        if status:
            query = query.filter(ModelRequest.status == status)
        
        return query.order_by(ModelRequest.createdAt.desc()).offset(skip).limit(limit).all()

    def update_model_request(
        self,
        db: Session, 
        request_id: UUID, 
        request_update: ModelRequestUpdate
    ) -> Optional[ModelRequest]:
        """Update a model request."""
        db_request = self.get_model_request(db, request_id)
        if not db_request:
            return None
        
        update_data = request_update.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_request, key, value)
        
        db_request.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_request)
        return db_request

    # Model Deployment Functions
    def launch_model(
        self,
        db: Session, 
        deployment: ModelDeploymentCreate
    ) -> ModelDeployment:
        """Launch a model and create a deployment record."""
        # Extract parameters for the launch command
        params = deployment.dict(exclude={"modelName", "userId"})
        
        # Get the enable_cloudflare_tunnel parameter
        enable_cloudflare_tunnel = params.pop("enable_cloudflare_tunnel", False)
        
        # Launch the model
        result = self.llm_client.launch_model(
            deployment.modelName, 
            enable_cloudflare_tunnel=enable_cloudflare_tunnel,
            **params
        )
        
        if not result.get("success", False):
            # Create a failed deployment record
            db_deployment = ModelDeployment(
                modelName=deployment.modelName,
                userId=deployment.userId,
                slurmJobId="failed",
                status="failed",
                errorMessage=result.get("error", "Unknown error"),
                resourceAllocation=params
            )
            db.add(db_deployment)
            db.commit()
            db.refresh(db_deployment)
            return db_deployment
        
        # Extract the Slurm job ID from the result
        slurm_job_id = result.get("job_id")
        if not slurm_job_id:
            # Create a failed deployment record
            db_deployment = ModelDeployment(
                modelName=deployment.modelName,
                userId=deployment.userId,
                slurmJobId="failed",
                status="failed",
                errorMessage="Failed to get Slurm job ID",
                resourceAllocation=params
            )
            db.add(db_deployment)
            db.commit()
            db.refresh(db_deployment)
            return db_deployment
        
        # Create a deployment record
        db_deployment = ModelDeployment(
            modelName=deployment.modelName,
            userId=deployment.userId,
            slurmJobId=slurm_job_id,
            status="launching",
            resourceAllocation=params
        )
        db.add(db_deployment)
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def get_deployment(self, db: Session, deployment_id: UUID) -> Optional[ModelDeployment]:
        """Get a model deployment by ID."""
        return db.query(ModelDeployment).filter(ModelDeployment.id == deployment_id).first()

    def get_deployment_by_job_id(self, db: Session, slurm_job_id: str) -> Optional[ModelDeployment]:
        """Get a model deployment by Slurm job ID."""
        return db.query(ModelDeployment).filter(ModelDeployment.slurmJobId == slurm_job_id).first()

    def get_deployments(
        self,
        db: Session, 
        user_id: Optional[UUID] = None,
        status: Optional[str] = None,
        skip: int = 0, 
        limit: int = 100
    ) -> List[ModelDeployment]:
        """Get model deployments with optional filters."""
        query = db.query(ModelDeployment)
        
        if user_id:
            query = query.filter(ModelDeployment.userId == user_id)
        
        if status:
            query = query.filter(ModelDeployment.status == status)
        
        return query.order_by(ModelDeployment.createdAt.desc()).offset(skip).limit(limit).all()

    def update_deployment(
        self,
        db: Session, 
        deployment_id: UUID, 
        deployment_update: ModelDeploymentUpdate
    ) -> Optional[ModelDeployment]:
        """Update a model deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None
        
        update_data = deployment_update.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_deployment, key, value)
        
        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def update_deployment_status(self, db: Session, deployment_id: UUID) -> Optional[ModelDeployment]:
        """Update the status of a model deployment by checking with llm-inference."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None
        
        # Skip if the deployment is already in a terminal state
        if db_deployment.status in ["failed", "shutdown"]:
            return db_deployment
            
        # Get the current status from llm-inference
        result = self.llm_client.get_model_status(db_deployment.slurmJobId)
        
        if not result.get("success", False):
            # Update the deployment status to failed
            db_deployment.status = "failed"
            db_deployment.errorMessage = result.get("error", "Failed to get status")
            db_deployment.updatedAt = datetime.utcnow()
            db.commit()
            db.refresh(db_deployment)
            return db_deployment
            
        # Extract the status from the result
        status = result.get("status", "unknown")
        
        # Map the status to our deployment status
        if status == "RUNNING":
            # Check if the endpoint is ready
            if result.get("endpoint_ready", False):
                db_deployment.status = "ready"
                db_deployment.endpointUrl = result.get("endpoint_url")
                
                # Try to get the tunnel URL if Cloudflare tunnel was enabled
                if db_deployment.resourceAllocation and db_deployment.resourceAllocation.get("enable_cloudflare_tunnel"):
                    # Construct the job name from the model name
                    job_name = db_deployment.modelName.replace("/", "-")
                    tunnel_url = self.llm_client.get_tunnel_url(job_name, db_deployment.slurmJobId)
                    if tunnel_url:
                        db_deployment.tunnelUrl = tunnel_url
            else:
                db_deployment.status = "launching"
        elif status == "PENDING" or status == "CONFIGURING":
            db_deployment.status = "launching"
        elif status == "FAILED" or status == "CANCELLED" or status == "TIMEOUT":
            db_deployment.status = "failed"
            db_deployment.errorMessage = f"Job {status.lower()}"
        elif status == "COMPLETED":
            db_deployment.status = "shutdown"
        
        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def shutdown_deployment(self, db: Session, deployment_id: UUID) -> Optional[ModelDeployment]:
        """Shutdown a model deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return None
        
        # Skip if the deployment is already in a terminal state
        if db_deployment.status in ["failed", "shutdown"]:
            return db_deployment
        
        # Shutdown the model
        result = self.llm_client.shutdown_model(db_deployment.slurmJobId)
        
        # Update the deployment regardless of the result
        db_deployment.status = "shutdown"
        db_deployment.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_deployment)
        return db_deployment

    def list_available_models(self) -> Dict[str, Any]:
        """List available models using llm-inference."""
        return self.llm_client.list_available_models()

    def get_model_details(self, model_name: str) -> Dict[str, Any]:
        """Get details of a specific model using llm-inference."""
        return self.llm_client.get_model_details(model_name)

    def get_deployment_metrics(self, deployment_id: UUID, db: Session) -> Dict[str, Any]:
        """Get metrics for a model deployment."""
        db_deployment = self.get_deployment(db, deployment_id)
        if not db_deployment:
            return {"success": False, "error": "Deployment not found"}
        
        # Skip if the deployment is not ready
        if db_deployment.status != "ready":
            return {"success": False, "error": f"Deployment is not ready (status: {db_deployment.status})"}
        
        # Get the metrics from llm-inference
        return self.llm_client.get_model_metrics(db_deployment.slurmJobId) 