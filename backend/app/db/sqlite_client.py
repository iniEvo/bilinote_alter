import sqlite3
from pathlib import Path

from app.db.engine import get_database_url


def _sqlite_path_from_url(database_url: str) -> str:
    if not database_url.startswith('sqlite:///'):
        raise ValueError('sqlite_client only supports sqlite:/// URLs')
    return database_url.removeprefix('sqlite:///')


def get_connection():
    db_path = Path(_sqlite_path_from_url(get_database_url()))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(db_path)
