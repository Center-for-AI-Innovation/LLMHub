"""Background service for periodic tasks."""

import asyncio
import logging
import random
from datetime import datetime, timedelta
from typing import List

from sqlalchemy.orm import Session

from app.models.model_deployment import ModelDeployment
from app.repositories.session import SessionLocal
from app.services.email_service import EmailService
from app.services.model_service import ModelService
from app.config.config import settings


logger = logging.getLogger(__name__)


class BackgroundService:
    """Service for background tasks."""

    def __init__(self):
        """Initialize the background service."""
        self.model_service = ModelService()
        self.email_service = EmailService()
        self.running = False
        self.sync_interval = settings.SYNC_INTERVAL
        self.expiry_check_interval = settings.EXPIRY_CHECK_INTERVAL
        self.model_sync_interval = settings.MODEL_SYNC_INTERVAL or 3600  # Default to 1 hour
        self.last_sync = datetime.utcnow()
        self.last_expiry_check = datetime.utcnow()
        self.last_model_sync = datetime.utcnow() - timedelta(hours=1)  # Force sync on startup
        
        # Rate limiting settings
        self.max_deployments_per_cycle = settings.MAX_DEPLOYMENTS_PER_CYCLE
        
        # Error handling settings
        self.error_backoff_base = 5  # Base backoff time in seconds
        self.error_backoff_max = 300  # Maximum backoff time in seconds
        self.consecutive_errors = 0
        
        logger.info(f"Background service initialized with sync_interval={self.sync_interval}s, expiry_check_interval={self.expiry_check_interval}s, model_sync_interval={self.model_sync_interval}s")

    async def start(self):
        """Start the background service."""
        self.running = True
        
        # Sync models on startup
        try:
            with SessionLocal() as db:
                logger.info("Syncing models on startup")
                result = self.model_service.sync_available_models(db)
                if result.get("success"):
                    logger.info(f"Successfully synced {result.get('count', 0)} models on startup")
                else:
                    logger.error(f"Failed to sync models on startup: {result.get('error', 'Unknown error')}")
        except Exception as e:
            logger.error(f"Error syncing models on startup: {e}")
        
        # Start periodic tasks
        asyncio.create_task(self._run_periodic_tasks())
        logger.info("Background service started")

    async def stop(self):
        """Stop the background service."""
        self.running = False
        logger.info("Background service stopped")

    async def _run_periodic_tasks(self):
        """Run periodic tasks."""
        while self.running:
            now = datetime.utcnow()
            
            try:
                # Run status synchronization
                if (now - self.last_sync).total_seconds() >= self.sync_interval:
                    await self._sync_deployment_statuses()
                    self.last_sync = now
                
                # Run expiry check
                if (now - self.last_expiry_check).total_seconds() >= self.expiry_check_interval:
                    await self._check_expired_deployments()
                    self.last_expiry_check = now
                
                # Run model sync
                if (now - self.last_model_sync).total_seconds() >= self.model_sync_interval:
                    await self._sync_models()
                    self.last_model_sync = now
                
                # Reset consecutive errors on successful execution
                self.consecutive_errors = 0
                
                # Sleep for a short time to avoid high CPU usage
                await asyncio.sleep(5)
                
            except Exception as e:
                # Increment consecutive errors
                self.consecutive_errors += 1
                
                # Calculate backoff time with jitter
                backoff_time = min(
                    self.error_backoff_base * (2 ** (self.consecutive_errors - 1)),
                    self.error_backoff_max
                )
                # Add jitter to avoid thundering herd problem
                backoff_time = backoff_time * (0.5 + random.random())
                
                logger.error(f"Error in background task: {e}. Backing off for {backoff_time:.2f}s")
                
                # Sleep for backoff time
                await asyncio.sleep(backoff_time)

    async def _sync_models(self):
        """Synchronize available models with the database."""
        try:
            with SessionLocal() as db:
                logger.info("Syncing available models")
                result = self.model_service.sync_available_models(db)
                if result.get("success"):
                    logger.info(f"Successfully synced {result.get('count', 0)} models")
                else:
                    logger.error(f"Failed to sync models: {result.get('error', 'Unknown error')}")
        except Exception as e:
            logger.error(f"Error syncing models: {e}")
            raise  # Re-raise to trigger backoff

    async def _sync_deployment_statuses(self):
        """Synchronize deployment statuses."""
        try:
            with SessionLocal() as db:
                active_deployments = self._get_active_deployments(db)
            
                # Apply rate limiting
                if len(active_deployments) > self.max_deployments_per_cycle:
                    logger.warning(
                        f"Rate limiting: Processing {self.max_deployments_per_cycle} out of {len(active_deployments)} deployments"
                    )
                    # Prioritize older deployments that haven't been updated recently
                    active_deployments.sort(key=lambda d: d.updatedAt)
                    active_deployments = active_deployments[:self.max_deployments_per_cycle]
            
                logger.info(f"Syncing status for {len(active_deployments)} active deployments")
            
                for deployment in active_deployments:
                    try:
                        updated = self.model_service.update_deployment_status(db, deployment.id)
                        if not updated:
                            await asyncio.sleep(0.5)
                            continue

                        # TODO: Need to handle sending an email if a launched deployment failed. 
                        if updated.notifiedAt is None:
                            if updated.status == "ready":
                                self.email_service.notify_deployment_ready(db, updated)
                                updated.notifiedAt = datetime.utcnow()
                                db.commit()
                            elif updated.status == "failed":
                                self.email_service.notify_deployment_failed(db, updated)
                                updated.notifiedAt = datetime.utcnow()
                                db.commit()

                        # Add a small delay between updates to avoid overwhelming the system
                        await asyncio.sleep(0.5)
                    except Exception as e:
                        logger.error(f"Error updating status for deployment {deployment.id}: {e}")
        except Exception as e:
            logger.error(f"Error in deployment status synchronization: {e}")
            raise  # Re-raise to trigger backoff

    async def _check_expired_deployments(self):
        """Check for expired deployments and shut them down."""
        try:
            with SessionLocal() as db:
                now = datetime.utcnow()
            
                # Get deployments that have expired but are still active
                expired_deployments = (
                    db.query(ModelDeployment)
                    .filter(
                        ModelDeployment.status.in_(["running", "ready"]),
                        ModelDeployment.expiresAt.isnot(None),
                        ModelDeployment.expiresAt <= now
                    )
                    .all()
                )
            
                # Apply rate limiting
                if len(expired_deployments) > self.max_deployments_per_cycle:
                    logger.warning(
                        f"Rate limiting: Processing {self.max_deployments_per_cycle} out of {len(expired_deployments)} expired deployments"
                    )
                    # Prioritize deployments that expired the longest time ago
                    expired_deployments.sort(key=lambda d: d.expiresAt)
                    expired_deployments = expired_deployments[:self.max_deployments_per_cycle]
            
                logger.info(f"Found {len(expired_deployments)} expired deployments to shut down")
            
                for deployment in expired_deployments:
                    try:
                        logger.info(f"Shutting down expired deployment {deployment.id}")
                        # Use the model service to shut down the deployment, which will also release resources
                        self.model_service.shutdown_deployment(db, deployment.id)
                        # Add a small delay between shutdowns to avoid overwhelming the system
                        await asyncio.sleep(1)
                    except Exception as e:
                        logger.error(f"Error shutting down expired deployment {deployment.id}: {e}")
        except Exception as e:
            logger.error(f"Error in expired deployment check: {e}")
            raise  # Re-raise to trigger backoff

    def _get_active_deployments(self, db: Session) -> List[ModelDeployment]:
        """Get active deployments that need status updates."""
        return (
            db.query(ModelDeployment)
            .filter(ModelDeployment.status.in_(["pending", "launching", "running", "ready"]))
            .all()
        )


# Singleton instance
background_service = BackgroundService() 
