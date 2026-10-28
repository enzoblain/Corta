"""Runtime configuration, read from environment variables only."""
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    app_password: str
    session_secret: str
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8000
    cookie_secure: bool = False
    session_ttl: int = 60 * 60 * 24 * 30  # seconds

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"


def load_config() -> Config:
    missing = [k for k in ("APP_PASSWORD", "SESSION_SECRET") if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    if os.environ["APP_PASSWORD"] == "change-me":
        raise SystemExit("APP_PASSWORD must be changed from the .env.example value")
    if len(os.environ["SESSION_SECRET"]) < 32:
        raise SystemExit("SESSION_SECRET must be at least 32 characters")
    return Config(
        app_password=os.environ["APP_PASSWORD"],
        session_secret=os.environ["SESSION_SECRET"],
        data_dir=Path(os.environ.get("DATA_DIR", "./data")),
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        cookie_secure=os.environ.get("COOKIE_SECURE", "0") == "1",
    )
