#!/bin/bash
python3 -m venv .venv
. .venv/bin/activate
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 10000
