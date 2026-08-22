"""
Database configuration and session management
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from core.config import get_settings

settings = get_settings()

# SQLite needs check_same_thread=False for FastAPI async
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency for FastAPI - yields a database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables and run seed if needed"""
    from models.db_models import User, Project, Scan, JobRecord
    Base.metadata.create_all(bind=engine)
    _migrate_job_columns()
    _seed_demo_user()


def _migrate_job_columns():
    """Add new columns to jobs table if missing (SQLite)."""
    import logging
    from sqlalchemy import text
    logger = logging.getLogger(__name__)
    new_cols = {
        "keyframes_json": "TEXT",
        "scene_manifest_json": "TEXT",
        "current_zone": "INTEGER",
        "total_zones": "INTEGER",
    }
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(jobs)")).fetchall()
            existing = {row[1] for row in rows}
            for col, typ in new_cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {col} {typ}"))
                    logger.info("Migrated jobs table: added column %s", col)
            conn.commit()
    except Exception as e:
        logger.warning("Job column migration skipped: %s", e)


def _seed_demo_user():
    """Seed demo user if not exists"""
    import logging
    logger = logging.getLogger(__name__)
    try:
        from passlib.context import CryptContext
        from models.db_models import User

        from core.brand import DEMO_EMAIL

        LEGACY_DEMO_EMAIL = "demo@gaussian-splat.demo"
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        db = SessionLocal()
        try:
            existing = db.query(User).filter(User.email == DEMO_EMAIL).first()
            if existing:
                logger.info("Demo user already exists")
                return

            legacy = db.query(User).filter(User.email == LEGACY_DEMO_EMAIL).first()
            if legacy:
                legacy.email = DEMO_EMAIL
                db.commit()
                logger.info("Migrated legacy demo user to %s", DEMO_EMAIL)
                return

            demo_user = User(
                email=DEMO_EMAIL,
                password_hash=pwd_context.hash("demo123"),
                is_demo=True,
            )
            db.add(demo_user)
            db.commit()
            logger.info("Demo user seeded successfully")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to seed demo user: {e}", exc_info=True)
