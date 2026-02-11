"""
Application configuration using pydantic_settings.
"""

from pathlib import Path
from typing import Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get project root (3 levels up from this file: app/core/config.py -> app -> .)
PROJECT_ROOT = Path(__file__).parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Supabase Configuration
    supabase_url: str
    supabase_key: str = Field(..., alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_bucket: str = "documents"
    
    # OpenRouter Configuration
    openrouter_api_key: str
    openrouter_model: str = "meta-llama/llama-3-8b-instruct"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    
    # Qdrant Configuration
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: Optional[str] = None
    
    # CORS Configuration
    cors_origins: list[str] = Field(
        default=["https://heritage.ekowlabs.space", "http://localhost:3000", "http://localhost:5173", "http://localhost:8080"],
        description="List of allowed CORS origins"
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)
    
    
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE.absolute()),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,
        populate_by_name=True  # Allow both alias (SUPABASE_SERVICE_ROLE_KEY) and field name (SUPABASE_KEY)
    )


settings = Settings()

