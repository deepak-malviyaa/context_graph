"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    neo4j_uri: str = "neo4j+s://463745b1.databases.neo4j.io"
    neo4j_username: str = "463745b1"
    neo4j_password: str = "y4Cby4cNR0RgNaE5L63C-JD0cQnM2S2_nvpzuVSaVso"
    neo4j_database: str = "neo4j"
    openai_api_key: str = ""
    groq_api_key: str = ""
    groq_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-120b"
    groq_extraction_model: str = "openai/gpt-oss-120b"
    extraction_enabled: bool = True
    domain_id: str = "agent-memory"
    session_strategy: str = "per_conversation"
    backend_port: int = 8000
    frontend_port: int = 3000









    model_config = {"env_file": "../.env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
