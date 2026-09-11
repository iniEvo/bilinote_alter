from sqlalchemy import Column, DateTime, Integer, String, Text, func

from app.db.engine import Base


class VideoTask(Base):
    __tablename__ = 'video_tasks'

    id = Column(Integer, primary_key=True, autoincrement=True)
    video_id = Column(String, nullable=False, index=True)
    platform = Column(String, nullable=False, index=True)
    task_id = Column(String, unique=True, nullable=False)
    batch_id = Column(String, nullable=True, index=True)
    batch_name = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    title = Column(String, nullable=True)
    request_payload = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)
