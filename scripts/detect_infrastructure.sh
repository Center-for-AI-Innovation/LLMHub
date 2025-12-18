#!/bin/bash

# Infrastructure Detection and Configuration Script
# This script detects SLURM partitions and hardware, then updates models.yaml accordingly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$PROJECT_DIR/config"
MODELS_YAML="$CONFIG_DIR/models.yaml"
MODELS_TEMPLATE="$CONFIG_DIR/models.yaml.template"
BACKUP_YAML="$CONFIG_DIR/models.yaml.backup"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required commands are available
check_dependencies() {
    log_info "Checking dependencies..." >&2
    
    local missing_deps=()
    
    if ! command -v sinfo &> /dev/null; then
        missing_deps+=("sinfo")
    fi
    
    if ! command -v scontrol &> /dev/null; then
        missing_deps+=("scontrol")
    fi
    
    if ! command -v python3 &> /dev/null; then
        missing_deps+=("python3")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}" >&2
        log_info "Try loading SLURM module: module load slurm" >&2
        exit 1
    fi
    
    log_success "All dependencies available" >&2
}

# Detect available partitions and their configurations
detect_partitions() {
    log_info "Detecting SLURM partitions..." >&2
    
    # Get partition information
    local partitions_info=$(sinfo -h -o "%P %G %f %a %l %D %C" | sort -u)
    
    if [ -z "$partitions_info" ]; then
        log_error "No partitions found or sinfo not accessible" >&2
        exit 1
    fi
    
    log_success "Found partitions:" >&2
    echo "$partitions_info" | while read -r line; do
        echo "  $line" >&2
    done
    
    # Debug: Print raw partitions info
    log_info "Raw partitions info:" >&2
    echo "$partitions_info" >&2
    
    # Create partitions JSON for Python processing
    local partitions_json="["
    local first=true
    
    # Use process substitution to avoid subshell issues
    while IFS=' ' read -r partition gres features avail timelimit nodes cpus; do
        if [ "$first" = true ]; then
            first=false
        else
            partitions_json+=","
        fi
        
        # Extract GPU info from GRES
        local gpu_count="null"
        local gpu_type="null"
        if [[ "$gres" != "N/A" && "$gres" != "" ]]; then
            if [[ "$gres" =~ gpu:([0-9]+) ]]; then
                gpu_count="${BASH_REMATCH[1]}"
            fi
            if [[ "$gres" =~ gpu:([a-zA-Z0-9-]+) ]]; then
                gpu_type="${BASH_REMATCH[1]}"
            fi
        fi
        
        # Escape any quotes in the features field
        features=$(echo "$features" | sed 's/"/\\"/g')
        
        partitions_json+="{\"name\":\"$partition\",\"gpu_count\":$gpu_count,\"gpu_type\":\"$gpu_type\",\"features\":\"$features\",\"available\":\"$avail\",\"timelimit\":\"$timelimit\",\"nodes\":$nodes,\"cpus\":\"$cpus\"}"
    done <<< "$partitions_info"
    
    partitions_json+="]"
    
    # Debug: Print generated JSON
    log_info "Generated partitions JSON:" >&2
    echo "$partitions_json" >&2
    
    echo "$partitions_json"
}

# Detect partitions and write to file
detect_partitions_to_file() {
    log_info "Detecting SLURM partitions..." >&2
    
    # Get partition information
    local partitions_info=$(sinfo -h -o "%P %G %f %a %l %D %C" | sort -u)
    
    if [ -z "$partitions_info" ]; then
        log_error "No partitions found or sinfo not accessible" >&2
        exit 1
    fi
    
    log_success "Found partitions:" >&2
    echo "$partitions_info" | while read -r line; do
        echo "  $line" >&2
    done
    
    # Debug: Print raw partitions info
    log_info "Raw partitions info:" >&2
    echo "$partitions_info" >&2
    
    # Create partitions JSON for Python processing
    local partitions_json="["
    local first=true
    
    # Use process substitution to avoid subshell issues
    while IFS=' ' read -r partition gres features avail timelimit nodes cpus; do
        if [ "$first" = true ]; then
            first=false
        else
            partitions_json+=","
        fi
        
        # Extract GPU info from GRES
        local gpu_count="null"
        local gpu_type="null"
        if [[ "$gres" != "N/A" && "$gres" != "" ]]; then
            if [[ "$gres" =~ gpu:([0-9]+) ]]; then
                gpu_count="${BASH_REMATCH[1]}"
            fi
            if [[ "$gres" =~ gpu:([a-zA-Z0-9-]+) ]]; then
                gpu_type="${BASH_REMATCH[1]}"
            fi
        fi
        
        # Escape any quotes in the features field
        features=$(echo "$features" | sed 's/"/\\"/g')
        
        partitions_json+="{\"name\":\"$partition\",\"gpu_count\":$gpu_count,\"gpu_type\":\"$gpu_type\",\"features\":\"$features\",\"available\":\"$avail\",\"timelimit\":\"$timelimit\",\"nodes\":$nodes,\"cpus\":\"$cpus\"}"
    done <<< "$partitions_info"
    
    partitions_json+="]"
    
    # Debug: Print generated JSON
    log_info "Generated partitions JSON:" >&2
    echo "$partitions_json" >&2
    
    # Write partitions JSON to file
    local partitions_file="$CONFIG_DIR/partitions.json"
    echo "$partitions_json" > "$partitions_file"
    log_success "Partitions written to: $partitions_file" >&2
}

# Get account from environment or use default
get_account() {
    local account="${SLURM_ACCOUNT:-default}"
    log_info "Using SLURM account: $account" >&2
    echo "$account"
}

# Detect default QoS
detect_qos() {
    log_info "Detecting default QoS..." >&2
    
    local qos_info=$(sacctmgr show qos format=Name,Priority -nP 2>/dev/null | head -1)
    
    if [ -n "$qos_info" ]; then
        local qos=$(echo "$qos_info" | cut -d'|' -f1)
        log_success "Detected default QoS: $qos" >&2
        echo "$qos"
    else
        log_warning "Using default QoS: normal" >&2
        echo "normal"
    fi
}

# Create infrastructure details file
create_infrastructure_file() {
    local account="$1"
    local qos="$2"
    
    log_info "Creating infrastructure details file..." >&2
    
    # Create infrastructure details file
    local infra_file="$CONFIG_DIR/infrastructure.yaml"
    local partitions_file="$CONFIG_DIR/partitions.json"
    
    # Create Python script to generate infrastructure file
    cat > "$SCRIPT_DIR/create_infra.py" << 'EOF'
#!/usr/bin/env python3
import json
import yaml
import sys
import os
from collections import Counter

def create_infrastructure_file(partitions_file_path, account, qos, infra_file_path):
    """Create infrastructure details file with partition and GPU information."""
    
    # Load partitions from file
    with open(partitions_file_path, 'r') as f:
        partitions = json.load(f)
    
    # Analyze partitions to find most common settings
    partition_names = [p['name'] for p in partitions]
    partition_counts = Counter(partition_names)
    most_common_partition = partition_counts.most_common(1)[0][0]
    
    # Find GPU partitions
    gpu_partitions = [p for p in partitions if p['gpu_count'] and p['gpu_count'] != 'null']
    
    # Find most common GPU settings
    gpu_counts = [int(p['gpu_count']) for p in gpu_partitions if p['gpu_count'] != 'null']
    gpu_types = [p['gpu_type'] for p in gpu_partitions if p['gpu_type'] != 'null']
    
    most_common_gpu_count = Counter(gpu_counts).most_common(1)[0][0] if gpu_counts else 1
    most_common_gpu_type = Counter(gpu_types).most_common(1)[0][0] if gpu_types else "A100"
    
    # Find most common time limit
    time_limits = [p['timelimit'] for p in partitions if p['timelimit'] and p['timelimit'] != 'N/A']
    most_common_time = Counter(time_limits).most_common(1)[0][0] if time_limits else "4:00:00"
    
    # Create infrastructure data
    infrastructure_data = {
        'account': account,
        'qos': qos,
        'defaults': {
            'partition': most_common_partition,
            'gpus_per_node': most_common_gpu_count,
            'gpu_type': most_common_gpu_type,
            'time': most_common_time
        },
        'partitions': {}
    }
    
    # Add detailed partition information
    for partition in partitions:
        name = partition['name']
        if name not in infrastructure_data['partitions']:
            infrastructure_data['partitions'][name] = {
                'gpu_count': partition['gpu_count'],
                'gpu_type': partition['gpu_type'],
                'features': partition['features'],
                'timelimit': partition['timelimit'],
                'nodes': partition['nodes'],
                'cpus': partition['cpus'],
                'available': partition['available']
            }
    
    # Write infrastructure file
    with open(infra_file_path, 'w') as f:
        yaml.dump(infrastructure_data, f, default_flow_style=False, sort_keys=False)
    
    print(f"Created infrastructure file: {infra_file_path}")
    print(f"Most common partition: {most_common_partition}")
    print(f"Most common GPU count: {most_common_gpu_count}")
    print(f"Most common GPU type: {most_common_gpu_type}")
    print(f"Most common time limit: {most_common_time}")
    
    return infrastructure_data

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print("Usage: python3 create_infra.py <partitions_file_path> <account> <qos> <infra_file_path>")
        sys.exit(1)
    
    partitions_file_path = sys.argv[1]
    account = sys.argv[2]
    qos = sys.argv[3]
    infra_file_path = sys.argv[4]
    
    try:
        create_infrastructure_file(partitions_file_path, account, qos, infra_file_path)
        print("SUCCESS: Infrastructure file created successfully")
    except Exception as e:
        print(f"ERROR: Failed to create infrastructure file: {e}")
        sys.exit(1)
EOF
    
    # Run the Python script
    cd "$PROJECT_DIR"
    python3 "$SCRIPT_DIR/create_infra.py" "$partitions_file" "$account" "$qos" "$infra_file"
    
    # Clean up
    rm -f "$SCRIPT_DIR/create_infra.py"
    
    log_success "Infrastructure file created: $infra_file" >&2
}

# Update models.yaml with placeholders
update_models_yaml() {
    local infra_file="$CONFIG_DIR/infrastructure.yaml"
    
    log_info "Updating models.yaml with placeholders..." >&2
    
    # Create backup of existing models.yaml if it exists
    if [ -f "$MODELS_YAML" ]; then
        cp "$MODELS_YAML" "$BACKUP_YAML"
        log_info "Created backup: $BACKUP_YAML" >&2
    fi
    
    # Create Python script to update models.yaml
    cat > "$SCRIPT_DIR/update_models.py" << 'EOF'
#!/usr/bin/env python3
import yaml
import sys
import os
import re

def update_models_yaml(models_template_path, models_yaml_path, infra_file_path):
    """Update models.yaml by replacing placeholders with infrastructure defaults."""
    
    # Load infrastructure data
    with open(infra_file_path, 'r') as f:
        infra_data = yaml.safe_load(f)
    
    # Load models template
    with open(models_template_path, 'r') as f:
        content = f.read()
    
    # Replace placeholders
    replacements = {
        '{{INFRA_ACCOUNT}}': infra_data['account'],
        '{{INFRA_QOS}}': infra_data['qos'],
        '{{INFRA_PARTITION}}': infra_data['defaults']['partition'],
        '{{INFRA_GPUS_PER_NODE}}': str(infra_data['defaults']['gpus_per_node']),
        '{{INFRA_GPU_TYPE}}': infra_data['defaults']['gpu_type'],
        '{{INFRA_TIME}}': infra_data['defaults']['time']
    }
    
    # Apply replacements
    updated_content = content
    for placeholder, value in replacements.items():
        updated_content = updated_content.replace(placeholder, value)
    
    # Write updated models.yaml
    with open(models_yaml_path, 'w') as f:
        f.write(updated_content)
    
    print(f"Updated models.yaml with infrastructure defaults")
    print(f"Account: {infra_data['account']}")
    print(f"QoS: {infra_data['qos']}")
    print(f"Partition: {infra_data['defaults']['partition']}")
    print(f"GPUs per node: {infra_data['defaults']['gpus_per_node']}")
    print(f"GPU type: {infra_data['defaults']['gpu_type']}")
    print(f"Time limit: {infra_data['defaults']['time']}")
    
    return True

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python3 update_models.py <models_template_path> <models_yaml_path> <infra_file_path>")
        sys.exit(1)
    
    models_template_path = sys.argv[1]
    models_yaml_path = sys.argv[2]
    infra_file_path = sys.argv[3]
    
    try:
        update_models_yaml(models_template_path, models_yaml_path, infra_file_path)
        print("SUCCESS: models.yaml updated successfully")
    except Exception as e:
        print(f"ERROR: Failed to update models.yaml: {e}")
        sys.exit(1)
EOF
    
    # Run the Python script
    cd "$PROJECT_DIR"
    python3 "$SCRIPT_DIR/update_models.py" "$MODELS_TEMPLATE" "$MODELS_YAML" "$infra_file"
    
    # Clean up
    rm -f "$SCRIPT_DIR/update_models.py"
    
    log_success "models.yaml updated with placeholders" >&2
}

# Main execution
main() {
    log_info "Starting infrastructure detection..." >&2
    
    # Check dependencies
    check_dependencies
    
    # Detect infrastructure and write to file
    detect_partitions_to_file
    local account=$(get_account)
    local qos=$(detect_qos)
    
    # Create infrastructure file
    create_infrastructure_file "$account" "$qos"
    
    # Update models.yaml with placeholders
    update_models_yaml
    
    log_success "Infrastructure detection and configuration complete!" >&2
    log_info "Updated models.yaml with:" >&2
    log_info "  - Account: $account" >&2
    log_info "  - Default QoS: $qos" >&2
    log_info "  - Partition-specific GPU and time settings" >&2
    
    # Show summary
    echo "" >&2
    log_info "Available partitions:" >&2
    if [ -f "$CONFIG_DIR/partitions.json" ]; then
        python3 -c "
import json
with open('$CONFIG_DIR/partitions.json', 'r') as f:
    data = json.load(f)
for p in data:
    print(f'  {p[\"name\"]}: {p[\"gpu_count\"]} GPUs ({p[\"gpu_type\"]}), {p[\"timelimit\"]} time limit')
" >&2
    fi
}

# Run main function
main "$@"
