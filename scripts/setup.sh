#!/bin/bash

# Setup script for Gaussian Splatting Room Reconstruction MVP

set -e

echo "Setting up Gaussian Splatting Room Reconstruction MVP..."

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not installed."
    exit 1
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed."
    exit 1
fi

# Check FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "Warning: FFmpeg is not found. Please install FFmpeg."
    echo "  macOS: brew install ffmpeg"
    echo "  Linux: sudo apt-get install ffmpeg"
fi

# Check COLMAP
if ! command -v colmap &> /dev/null; then
    echo "Warning: COLMAP is not found. Please install COLMAP."
    echo "  macOS: brew install colmap"
    echo "  Linux: sudo apt-get install colmap"
fi

# Setup backend
echo "Setting up backend..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cd ..

# Setup frontend
echo "Setting up frontend..."
cd frontend
npm install
cd ..

echo ""
echo "Setup complete!"
echo ""
echo "To run the application:"
echo "  1. Start backend: cd backend && source venv/bin/activate && uvicorn main:app --reload"
echo "  2. Start frontend: cd frontend && npm run dev"
echo ""
