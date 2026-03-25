from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()

# Allow Vite dev server and local requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "QueryCraft backend"}


class QueryRequest(BaseModel):
    query: str


@app.post("/query")
def run_query(req: QueryRequest):
    # Placeholder implementation:
    # Replace with real DB execution logic later.
    sample = {
        "columns": ["id", "name"],
        "rows": [[1, "Alice"], [2, "Bob"]],
        "query_received": req.query,
    }
    return sample