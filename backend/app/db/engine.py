import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

_WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
_LEGACY_BACKEND_DB = _WORKSPACE_ROOT / 'backend' / 'bili_note.db'
_DEFAULT_DB_PATH = _WORKSPACE_ROOT / 'bili_note.db'


def _default_database_url() -> str:
    # Prefer the workspace-level database so backend can be started from either
    # the repo root or backend/ without splitting data across two SQLite files.
    if _LEGACY_BACKEND_DB.exists() and not _DEFAULT_DB_PATH.exists():
        return f'sqlite:///{_LEGACY_BACKEND_DB}'
    return f'sqlite:///{_DEFAULT_DB_PATH}'


# 默认 SQLite，如果想换 PostgreSQL 或 MySQL，可以直接改 .env
DATABASE_URL = os.getenv('DATABASE_URL', _default_database_url())

# SQLite 需要特定连接参数，其他数据库不需要
engine_args = {}
if DATABASE_URL.startswith('sqlite'):
    engine_args['connect_args'] = {'check_same_thread': False}

_pool_args = {}
if not DATABASE_URL.startswith('sqlite'):
    _pool_args = {
        'pool_size': int(os.getenv('DB_POOL_SIZE', '10')),
        'max_overflow': int(os.getenv('DB_MAX_OVERFLOW', '20')),
        'pool_pre_ping': True,
    }

engine = create_engine(
    DATABASE_URL,
    echo=os.getenv('SQLALCHEMY_ECHO', 'false').lower() == 'true',
    **engine_args,
    **_pool_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_engine():
    return engine


def get_database_url() -> str:
    return DATABASE_URL


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
