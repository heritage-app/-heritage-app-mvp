"""
Script to automatically create a super admin user if it doesn't exist.
Run with: uv run python scripts/create_super_admin.py
"""
import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import bcrypt
from app.core.config import settings
from app.storage.repositories.users import UserRepository

logger = logging.getLogger(__name__)


async def create_super_admin():
    """Create super admin user if credentials are configured and user doesn't exist."""

    if not settings.super_admin_email or not settings.super_admin_password:
        logger.info("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD not configured. Skipping.")
        return

    logger.info(f"Checking for super admin user: {settings.super_admin_email}")

    existing_user = await UserRepository.get_user_by_email(settings.super_admin_email)

    if existing_user:
        # Update role to admin if not already
        if existing_user.get("role") != "admin":
            await UserRepository.update_user_role(existing_user["_id"], "admin")
            logger.info(f"Updated existing user to admin role: {settings.super_admin_email}")
        else:
            logger.info(f"Super admin already exists: {settings.super_admin_email}")
        return

    # Create new super admin - truncate password to 72 bytes (bcrypt limit)
    password_bytes = settings.super_admin_password.encode('utf-8')[:72]
    hashed_password = bcrypt.hash(password_bytes).decode('utf-8')

    new_user = await UserRepository.create_user(
        email=settings.super_admin_email,
        hashed_password=hashed_password,
        role="admin",
        display_name=settings.super_admin_display_name or "Super Admin"
    )

    logger.info(f"Created super admin user: {settings.super_admin_email}")
    logger.info(f"User ID: {new_user['_id']}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    asyncio.run(create_super_admin())