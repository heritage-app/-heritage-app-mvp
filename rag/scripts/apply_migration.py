import os
import sys
import urllib.parse
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def apply_migration() -> None:
    print("🚀 Starting Heritage RAG Migration...")

    try:
        import psycopg2
    except ImportError:
        print("❌ Error: 'psycopg2-binary' is not installed.")
        print("💡 Run: uv add psycopg2-binary")
        return

    project_id = "qlogstbewhqwumuwvglx"

    db_pass = os.getenv("SUPABASE_DB_PASSWORD")
    if not db_pass:
        print("❌ SUPABASE_DB_PASSWORD not found in .env")
        return

    encoded_pass = urllib.parse.quote_plus(db_pass)

    # Supabase Transaction Pooler (uses port 6543)
    db_user = f"postgres.{project_id}"
    db_host = "aws-0-eu-west-1.pooler.supabase.com"
    db_port = 6543
    db_name = "postgres"

    db_url = (
        f"postgresql://{db_user}:{encoded_pass}"
        f"@{db_host}:{db_port}/{db_name}?sslmode=require"
    )

    possible_paths = [
        Path("supabase/migrations/20260409000000_initial_schema.sql"),
        Path("C:/Users/pc/.gemini/antigravity/brain/adb986c1-8a18-4a93-b318-da8d9c3f3dc0/supabase_migration.sql"),
    ]

    migration_file = next((p for p in possible_paths if p.exists()), None)

    if not migration_file:
        print("❌ Error: Migration SQL file not found.")
        return

    print(f"📄 Using migration file: {migration_file}")
    print(f"📡 Connecting to Supabase pooler as '{db_user}'...")

    conn = None
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False

        sql = migration_file.read_text(encoding="utf-8")

        with conn.cursor() as cur:
            print("⏳ Executing SQL...")
            cur.execute(sql)

        conn.commit()
        print("✅ Migration successful! All tables created.")

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"❌ Error during migration: {e}")
        print(
            "\nNotes:\n"
            "- Make sure the database password is correct.\n"
            "- Use the exact Session pooler credentials from Supabase Dashboard > Connect.\n"
            "- If this still fails, rotate the DB password and retry."
        )
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    apply_migration()