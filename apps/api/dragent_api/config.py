import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[3]
LOCAL_DATA = ROOT / "local_data"
OBJECT_ROOT = LOCAL_DATA / "objects"
DB_PATH = LOCAL_DATA / "metadata.json"
PROJECT_ID = os.getenv("PROJECT_ID", "p_local")

DRAGENT_STORE = os.getenv("DRAGENT_STORE", "json").lower()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://dragent:dragent@localhost:5432/dragent")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "dragent-neo4j")
VECTOR_BACKEND = os.getenv("VECTOR_BACKEND", "local").lower()
RAGFLOW_BASE_URL = os.getenv("RAGFLOW_BASE_URL", "").rstrip("/")
RAGFLOW_API_KEY = os.getenv("RAGFLOW_API_KEY", "")
RAGFLOW_TIMEOUT_SECONDS = float(os.getenv("RAGFLOW_TIMEOUT_SECONDS", "30"))
