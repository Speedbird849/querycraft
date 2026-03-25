# QueryCraft

Minimal scaffold to run a React frontend (Vite) with a FastAPI backend.

## Backend (FastAPI)

1. Create a Python environment (recommended):

```bash
python -m venv .venv
.venv\Scripts\activate
```

2. Install dependencies:

```bash
pip install -r backend/requirements.txt
```

3. Run backend:

```bash
uvicorn backend.main:app --reload --port 8000
```

The backend exposes:
- `GET /` - simple health message
- `POST /query` - accepts JSON `{ "query": "..." }` and returns a sample table

## Frontend (React + Vite)

1. Change to the `frontend` folder and install:

```bash
cd frontend
npm install
```

2. Run the dev server:

```bash
npm run dev
```

The frontend will run at `http://localhost:5173` and communicates with the backend at `http://localhost:8000`.

Notes:
- This scaffold intentionally excludes Tailwind and AI features for now.
- Replace the placeholder `/query` implementation in `backend/main.py` with real DB logic when ready.
