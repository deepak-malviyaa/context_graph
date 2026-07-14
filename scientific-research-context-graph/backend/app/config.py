"""Application configuration from environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings

# Resolve .env at the repo root regardless of cwd (backend/app/config.py -> ../../.env)
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    neo4j_uri: str = "neo4j+s://463745b1.databases.neo4j.io"
    neo4j_username: str = "463745b1"
    neo4j_password: str = "y4Cby4cNR0RgNaE5L63C-JD0cQnM2S2_nvpzuVSaVso"
    neo4j_database: str = "neo4j"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    groq_api_key: str = ""
    groq_model: str = ""
    groq_url: str = "https://api.groq.com/openai/v1"
    domain_id: str = "scientific-research"
    session_strategy: str = "persistent"
    backend_port: int = 8002
    frontend_port: int = 3001









    model_config = {"env_file": str(_ENV_FILE), "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
