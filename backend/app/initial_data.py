from sqlmodel import Session

from app.core.db import engine, init_db
from app.logger import app_logger


def init() -> None:
    with Session(engine) as session:
        init_db(session)


def main() -> None:
    app_logger.info("Creating initial data")
    init()
    app_logger.info("Initial data created")


if __name__ == "__main__":
    main()
