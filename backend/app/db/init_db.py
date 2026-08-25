from sqlalchemy import inspect, text

from app.db.engine import Base, get_engine
from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.video_tasks import VideoTask


def _ensure_video_tasks_columns(engine):
    inspector = inspect(engine)
    if 'video_tasks' not in inspector.get_table_names():
        return

    columns = {column['name'] for column in inspector.get_columns('video_tasks')}
    statements = []
    if 'batch_id' not in columns:
        statements.append('ALTER TABLE video_tasks ADD COLUMN batch_id VARCHAR')
    if 'source_url' not in columns:
        statements.append('ALTER TABLE video_tasks ADD COLUMN source_url VARCHAR')
    if 'title' not in columns:
        statements.append('ALTER TABLE video_tasks ADD COLUMN title VARCHAR')
    if 'batch_name' not in columns:
        statements.append('ALTER TABLE video_tasks ADD COLUMN batch_name VARCHAR')
    if 'request_payload' not in columns:
        statements.append('ALTER TABLE video_tasks ADD COLUMN request_payload TEXT')

    if not statements:
        return

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
        conn.execute(text('CREATE INDEX IF NOT EXISTS ix_video_tasks_batch_id ON video_tasks (batch_id)'))


def init_db():
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _ensure_video_tasks_columns(engine)
