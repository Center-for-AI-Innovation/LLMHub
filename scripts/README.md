# Infrastructure Detection Script

This directory contains the infrastructure detection script that automatically configures the application based on the underlying SLURM infrastructure.

## Script Overview

### `detect_infrastructure.sh`
Detects SLURM partitions, hardware configurations, and updates `config/models.yaml` accordingly.

**Features:**
- Detects available SLURM partitions
- Identifies GPU types and counts per partition
- Detects your SLURM account and default QoS
- Writes partition details to `config/partitions.json`
- Creates `config/infrastructure.yaml` with analyzed infrastructure information
- Analyzes partitions to find most common settings (partition, GPU count, GPU type, time limit)
- Updates `config/models.yaml` by replacing placeholders with infrastructure defaults
- Creates backup of original configuration

**Usage:**
```bash
# Run infrastructure detection manually
./scripts/detect_infrastructure.sh
```

**Note:** This script is automatically run by the application unless skipped (see Application Usage below).

## Infrastructure Detection Process

The infrastructure detection script performs the following steps:

1. **Dependency Check**: Verifies SLURM commands are available
2. **Partition Detection**: Uses `sinfo` to get partition information
3. **Account Detection**: Uses `sacctmgr` to detect your SLURM account
4. **QoS Detection**: Identifies default QoS settings
5. **Infrastructure Analysis**: Analyzes partitions to find most common settings
6. **Infrastructure File Creation**: Creates `config/infrastructure.yaml` with detailed partition information
7. **Placeholder Replacement**: Updates `config/models.yaml` by replacing placeholders with infrastructure defaults

## Configuration Files

### `config/partitions.json`
Raw partition information detected from SLURM:
- Contains JSON array of all partitions with their details
- Includes GPU information, features, time limits, node counts, etc.
- Used as input for infrastructure analysis

### `config/infrastructure.yaml`
Analyzed infrastructure information:
- `account`: Your SLURM account
- `qos`: Default QoS setting
- `defaults`: Most common settings across all partitions
  - `partition`: Most common partition name
  - `gpus_per_node`: Most common GPU count
  - `gpu_type`: Most common GPU type
  - `time`: Most common time limit
- `partitions`: Detailed information for each partition

### `config/models.yaml` Placeholders
The script replaces the following placeholders in `config/models.yaml`:
- `{{INFRA_ACCOUNT}}`: Your SLURM account
- `{{INFRA_QOS}}`: Default QoS setting
- `{{INFRA_PARTITION}}`: Most common partition
- `{{INFRA_GPUS_PER_NODE}}`: Most common GPU count
- `{{INFRA_GPU_TYPE}}`: Most common GPU type
- `{{INFRA_TIME}}`: Most common time limit

## Environment Variables

The scripts use the following environment variables:

- `MODEL_CONFIG_PATH`: Path to models.yaml (set in .env)
- `SLURM_ACCOUNT`: Your SLURM account

## Troubleshooting

### Common Issues

1. **SLURM commands not found**
   ```bash
   module load slurm
   ```

2. **Permission denied**
   ```bash
   chmod +x scripts/*.sh
   ```

3. **Python dependencies missing**
   ```bash
   pip install pyyaml
   ```

4. **Virtual environment not found**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```

### Logs

- Application logs: `logs/backend.out`
- SLURM job logs: `logs/backend.<JOB_ID>.out`
- Infrastructure detection: Console output

### Backup Files

The infrastructure detection creates backups:
- `config/models.yaml.backup`: Backup of original configuration

## Application Usage

The application (`app/main.py`) now includes infrastructure detection and startup functionality:

### Basic Usage
```bash
# Start with infrastructure detection (default)
python app/main.py

# Start with uvicorn (also runs infrastructure detection)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Advanced Usage
```bash
# Custom host and port
python app/main.py --host 127.0.0.1 --port 8080

# Skip infrastructure detection
python app/main.py --skip-infrastructure

# Use custom model config
python app/main.py --model-config /path/to/custom/models.yaml

# Specify SLURM account
python app/main.py --slurm-account your_account_name

# Show help
python app/main.py --help
```

### Environment Variables
```bash
# Skip infrastructure detection via environment
SKIP_INFRASTRUCTURE_DETECTION=true python app/main.py

# Custom model config via environment
MODEL_CONFIG_PATH=/path/to/models.yaml python app/main.py

# SLURM account via environment
SLURM_ACCOUNT=your_account_name python app/main.py
```

### Background Deployment
```bash
# Start in background with nohup
nohup python app/main.py > logs/backend.out 2>&1 &

# Start in background with uvicorn
nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 > logs/backend.out 2>&1 &
```

### SLURM Job Deployment
```bash
# Create a simple SLURM job script
cat > run_backend.sbatch << 'EOF'
#!/bin/bash
#SBATCH --job-name=llm-backend
#SBATCH --account=your_account
#SBATCH --partition=cpu
#SBATCH --time=12:00:00
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --output=logs/backend.%j.out
#SBATCH --error=logs/backend.%j.err

cd $HOME/llm-serving-backend
source .venv/bin/activate
python app/main.py
EOF

# Submit job
sbatch run_backend.sbatch
```
