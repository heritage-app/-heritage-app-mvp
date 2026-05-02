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
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_bucket: str = "documents"
    supabase_jwt_secret: str = Field(default="", description="Supabase JWT secret for auth verification")

    # Auth Configuration - CRITICAL: Must be set in production
    jwt_secret_key: str = Field(default="", description="JWT signing secret - MUST be set in production")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440 # 24 hours
    
    # MongoDB Configuration
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "heritage-app"
    
    # OpenRouter Configuration
    openrouter_api_key: str
    openrouter_model: str = "meta-llama/llama-3-8b-instruct"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    
    # Google Gemini Configuration
    google_api_key: Optional[str] = None
    llm_provider: str = "google" # Default to google
    gemini_model: str = "gemini-1.5-flash" # Use stable Flash
    
    # Qdrant Configuration
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: Optional[str] = None
    
    # CORS Configuration
    cors_origins: str | list[str] = Field(
        default=["http://localhost:3000", "http://localhost:5173"],
        description="List of allowed CORS origins"
    )
    
    # Admin Configuration
    admin_user_ids: str | list[str] = Field(
        default=[],
        description="List of Supabase user IDs that have administrative access"
    )

    # Super Admin Configuration
    super_admin_email: str = Field(
        default="",
        description="Email for super admin user (auto-created if not exists)"
    )
    super_admin_password: str = Field(
        default="",
        description="Password for super admin user"
    )
    super_admin_display_name: str = Field(
        default="Super Admin",
        description="Display name for super admin"
    )

    @field_validator("admin_user_ids", mode="before")
    @classmethod
    def assemble_admin_ids(cls, v: any) -> list[str]:
        if isinstance(v, str):
            v_stripped = v.strip()
            if v_stripped.startswith("[") and v_stripped.endswith("]"):
                import json
                try:
                    return json.loads(v_stripped)
                except Exception:
                    # If it looks like JSON but fails, it might be malformed.
                    # We'll fall back to comma splitting but strip quotes just in case.
                    pass
            return [i.strip().strip("'").strip('"') for i in v_stripped.split(",") if i.strip()]
        return v

    @field_validator("supabase_url", mode="after")
    @classmethod
    def ensure_trailing_slash(cls, v: str) -> str:
        if v and not v.endswith("/"):
            return f"{v}/"
        return v


    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: any) -> list[str]:
        if isinstance(v, str):
            v_stripped = v.strip()
            if v_stripped.startswith("[") and v_stripped.endswith("]"):
                import json
                try:
                    return json.loads(v_stripped)
                except Exception:
                    # Fall back to comma splitting but be careful with brackets/quotes
                    pass
            # Split by comma and strip common surrounding characters from items
            return [i.strip().strip("'").strip('"').strip("[").strip("]") for i in v_stripped.split(",") if i.strip()]
        return v
    
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE.absolute()),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,
        populate_by_name=True
    )


settings = Settings()
