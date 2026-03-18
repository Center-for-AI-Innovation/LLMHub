"""
Infrastructure management utilities for multi-infrastructure support.

This module provides functionality to detect, select, and manage different
infrastructure configurations (campus-cluster, delta, delta-ai-ncsa, etc.).
"""

import os
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List
from app.config.logging import get_logger

logger = get_logger("infrastructure")

# Environment variable that overrides auto-detection (e.g. INFRASTRUCTURE=delta-ai-ncsa)
INFRASTRUCTURE_ENV_VAR = "INFRASTRUCTURE"


class InfrastructureManager:
    """Manages infrastructure-specific configurations."""
    
    # Infrastructure identifiers
    INFRASTRUCTURES = {
        "campus-cluster": {
            "name": "Campus Cluster",
            "hostname_patterns": ["cc-login", "campuscluster"],
            "default": True
        },
        "delta": {
            "name": "Delta",
            "hostname_patterns": ["delta"],
            "default": False
        },
        "delta-ai-ncsa": {
            "name": "Delta AI NCSA",
            "hostname_patterns": ["delta-ai"],
            "default": False
        }
    }
    
    def __init__(self, config_dir: Optional[Path] = None):
        """Initialize infrastructure manager.
        
        Args:
            config_dir: Base configuration directory. Defaults to project config directory.
        """
        if config_dir is None:
            # Get project root (assuming this file is in app/utils/)
            project_root = Path(__file__).parent.parent.parent
            config_dir = project_root / "config"
        
        self.config_dir = Path(config_dir)
        self.infrastructures_dir = self.config_dir / "infrastructures"

    def get_infrastructure_from_env(self) -> Optional[str]:
        """Check which infrastructure is set via environment variable.
        
        Reads INFRASTRUCTURE (or INFRASTRUCTURE_ENV_VAR). Value is normalized
        (stripped, case-insensitive match against known infrastructures).
        
        Returns:
            Valid infrastructure id if env is set and valid, else None.
        """
        raw = os.environ.get(INFRASTRUCTURE_ENV_VAR)
        if not raw or not raw.strip():
            return None
        value = raw.strip()
        # Exact match
        if value in self.INFRASTRUCTURES:
            logger.info(f"Infrastructure from env {INFRASTRUCTURE_ENV_VAR}={value!r}")
            return value
        # Case-insensitive match
        value_lower = value.lower()
        for infra_id in self.INFRASTRUCTURES:
            if infra_id.lower() == value_lower:
                logger.info(f"Infrastructure from env {INFRASTRUCTURE_ENV_VAR}={value!r} -> {infra_id}")
                return infra_id
        logger.warning(f"Unknown value for {INFRASTRUCTURE_ENV_VAR}={value!r}; known: {list(self.INFRASTRUCTURES.keys())}")
        return None
        
    def detect_infrastructure(self) -> Optional[str]:
        """Auto-detect infrastructure based on environment variable, then hostname.
        
        Order: 1) INFRASTRUCTURE env var (if set and valid), 2) hostname patterns, 3) default.
        
        Returns:
            Infrastructure identifier (e.g., "campus-cluster").
        """
        # Prefer explicit env variable when set
        env_infra = self.get_infrastructure_from_env()
        if env_infra is not None:
            return env_infra
        
        hostname = os.uname().nodename if hasattr(os, 'uname') else os.environ.get('HOSTNAME', '')
        hostname_lower = hostname.lower()
        
        # Check hostname patterns
        for infra_id, infra_info in self.INFRASTRUCTURES.items():
            for pattern in infra_info.get("hostname_patterns", []):
                if pattern.lower() in hostname_lower:
                    logger.info(f"Detected infrastructure '{infra_id}' from hostname pattern '{pattern}'")
                    return infra_id
        
        # Return default if available
        for infra_id, infra_info in self.INFRASTRUCTURES.items():
            if infra_info.get("default", False):
                logger.info(f"Using default infrastructure '{infra_id}'")
                return infra_id
        
        logger.warning("Could not detect infrastructure, using 'campus-cluster' as fallback")
        return "campus-cluster"
    
    def get_infrastructure(self, infrastructure: Optional[str] = None) -> str:
        """Get infrastructure identifier.
        
        Args:
            infrastructure: Explicit infrastructure name. If None, auto-detects.
            
        Returns:
            Infrastructure identifier.
        """
        if infrastructure:
            if infrastructure not in self.INFRASTRUCTURES:
                logger.warning(f"Unknown infrastructure '{infrastructure}', using detected infrastructure")
                return self.detect_infrastructure() or "campus-cluster"
            return infrastructure
        
        return self.detect_infrastructure() or "campus-cluster"
    
    def get_config_path(self, infrastructure: Optional[str] = None) -> Path:
        """Get path to infrastructure-specific config directory.
        
        Args:
            infrastructure: Infrastructure identifier. If None, auto-detects.
            
        Returns:
            Path to infrastructure config directory.
        """
        infra_id = self.get_infrastructure(infrastructure)
        infra_path = self.infrastructures_dir / infra_id
        
        if not infra_path.exists():
            logger.warning(f"Infrastructure config directory not found: {infra_path}")
            logger.info(f"Falling back to base config directory: {self.config_dir}")
            return self.config_dir
        
        return infra_path
    
    def get_environment_config(self, infrastructure: Optional[str] = None) -> Dict[str, Any]:
        """Load environment.yaml for specified infrastructure.
        
        Args:
            infrastructure: Infrastructure identifier. If None, auto-detects.
            
        Returns:
            Environment configuration dictionary.
        """
        config_path = self.get_config_path(infrastructure)
        env_file = config_path / "environment.yaml"
        
        # Fallback to base config if infrastructure-specific doesn't exist
        if not env_file.exists():
            env_file = self.config_dir / "environment.yaml"
        
        if not env_file.exists():
            logger.error(f"environment.yaml not found at {env_file}")
            return {}
        
        try:
            with open(env_file, 'r') as f:
                config = yaml.safe_load(f)
            logger.info(f"Loaded environment config from: {env_file}")
            return config or {}
        except Exception as e:
            logger.error(f"Failed to load environment config from {env_file}: {e}")
            return {}
    
    def list_infrastructures(self) -> List[Dict[str, Any]]:
        """List all available infrastructures.
        
        Returns:
            List of infrastructure information dictionaries.
        """
        infrastructures = []
        for infra_id, infra_info in self.INFRASTRUCTURES.items():
            infra_path = self.infrastructures_dir / infra_id
            env_file = infra_path / "environment.yaml"
            
            infrastructures.append({
                "id": infra_id,
                "name": infra_info["name"],
                "available": env_file.exists(),
                "config_path": str(infra_path),
                "default": infra_info.get("default", False)
            })
        
        return infrastructures
    
    def setup_infrastructure(self, infrastructure: Optional[str] = None) -> Path:
        """Setup infrastructure configuration by creating symlinks or copying configs.
        
        This creates a symlink from the base config directory to the infrastructure-specific
        directory so that VEC_INF_CONFIG_DIR points to the correct infrastructure.
        
        Args:
            infrastructure: Infrastructure identifier. If None, auto-detects.
            
        Returns:
            Path to the active infrastructure config directory.
        """
        infra_id = self.get_infrastructure(infrastructure)
        infra_path = self.get_config_path(infrastructure)
        
        logger.info(f"Setting up infrastructure '{infra_id}' at {infra_path}")
        
        # Verify infrastructure config exists
        env_file = infra_path / "environment.yaml"
        if not env_file.exists():
            logger.error(f"Infrastructure config not found: {env_file}")
            raise FileNotFoundError(f"Infrastructure config not found: {env_file}")
        
        # Check if models.yaml exists (can be shared or infrastructure-specific)
        models_file = infra_path / "models.yaml"
        if not models_file.exists():
            # Use base models.yaml if infrastructure-specific doesn't exist
            base_models = self.config_dir / "models.yaml"
            if base_models.exists():
                logger.info(f"Using shared models.yaml from {base_models}")
            else:
                logger.warning(f"models.yaml not found in infrastructure or base config")
        
        return infra_path
