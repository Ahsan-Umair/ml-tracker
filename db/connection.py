# db/connection.py
# ─────────────────────────────────────────────────────────────
# Creates ONE SQLAlchemy engine shared by the whole app.
# Credentials live in .env — never hardcoded.
# ─────────────────────────────────────────────────────────────
from sqlalchemy import create_engine
from dotenv import load_dotenv
import os

load_dotenv()   # reads .env file into os.environ

DB_URL = (
    f"mysql+pymysql://{os.getenv('DB_USER')}:{os.getenv('DB_PASS')}"
    f"@{os.getenv('DB_HOST', 'localhost')}"
    f":{os.getenv('DB_PORT', '3306')}"
    f"/{os.getenv('DB_NAME', 'ml_tracker')}"
)

engine = create_engine(
    DB_URL,
    pool_pre_ping=True,    # auto-reconnect if connection drops
    pool_recycle=3600,     # recycle connections every hour
    echo=False,            # set True to log all SQL for debugging
)
