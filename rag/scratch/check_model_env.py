from app.core.config import settings
import os

print("\nMODEL CONFIGURATION CHECK")
print("-" * 30)
print(f"ENV GEMINI_MODEL: {os.getenv('GEMINI_MODEL')}")
print(f"SETTINGS.gemini_model: {settings.gemini_model}")
print(f"SETTINGS.llm_provider: {settings.llm_provider}")
print("-" * 30)
