from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.engine_options import application_engine_options

engine = create_engine(
    settings.database_url,
    **application_engine_options(settings),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
