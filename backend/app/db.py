import os

from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/uptime"
)

engine = create_engine(DATABASE_URL, echo=False)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
