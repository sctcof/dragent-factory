from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCAL_DATA = ROOT / "local_data"
OBJECT_ROOT = LOCAL_DATA / "objects"
DB_PATH = LOCAL_DATA / "metadata.json"
PROJECT_ID = "p_local"
