#!/bin/bash

# Exit on error
set -e

# Check if we're in a virtual environment
if [ -z "$VIRTUAL_ENV" ]; then
    echo "No active virtual environment detected."
    
    # Check if .venv exists
    if [ -d ".venv" ]; then
        echo "Activating existing virtual environment..."
        source .venv/bin/activate
    else
        echo "Creating and activating virtual environment..."
        if command -v uv &> /dev/null; then
            uv venv .venv
            source .venv/bin/activate
        else
            echo "uv not found, using python venv..."
            python -m venv .venv
            source .venv/bin/activate
            pip install --upgrade pip
        fi
    fi
fi

# Install or update dependencies including custom vec-inf
echo "Installing/updating dependencies..."
if command -v uv &> /dev/null; then
    uv pip install -e .
else
    pip install -e .
fi

# Start the application
echo "Starting the application..."
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload 