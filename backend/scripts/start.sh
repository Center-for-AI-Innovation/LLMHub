#!/bin/bash

# Exit on error
set -e

usage() {
    echo "Usage: $0 [port]"
    echo "Example: $0 8001"
}

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
fi

if [ "$#" -gt 1 ]; then
    usage
    exit 1
fi

APP_PORT="${1:-8000}"
if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || [ "$APP_PORT" -lt 1 ] || [ "$APP_PORT" -gt 65535 ]; then
    echo "Invalid port: $APP_PORT"
    usage
    exit 1
fi

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
echo "Starting the application on port $APP_PORT..."
uvicorn app.main:app --host 0.0.0.0 --port "$APP_PORT" --reload 
