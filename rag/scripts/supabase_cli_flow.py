import os
import subprocess
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def run_command(command, env=None):
    """Run a shell command and print output."""
    print(f"\n🏃 Running: {' '.join(command)}")
    try:
        # We use shell=True on Windows for npx.cmd to work reliably
        process = subprocess.Popen(
            command,
            env={**os.environ, **(env or {})},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            shell=True
        )
        
        for line in process.stdout:
            print(line, end="")
            
        process.wait()
        return process.returncode == 0
    except Exception as e:
        print(f"❌ Error executing command: {e}")
        return False

def main():
    print("🚀 Heritage RAG - Supabase CLI Automated Flow")
    
    # 1. Login
    if not run_command(["npx.cmd", "supabase", "login"]):
        print("❌ Login failed.")
        return

    # 2. Link
    project_ref = "qlogstbewhqwumuwvglx"
    if not run_command(["npx.cmd", "supabase", "link", "--project-ref", project_ref]):
        print("❌ Linking failed.")
        return

    # 3. DB Push (Migration)
    db_pass = os.getenv("SUPABASE_DB_PASSWORD")
    if not db_pass:
        db_pass = input("\n🔑 Please enter your Supabase Database Password for the 'db push' step: ")
    
    print("\n⏳ Attempting to push migrations to remote...")
    # We set SUPABASE_DB_PASSWORD in the environment as the CLI suggests
    if not run_command(["npx.cmd", "supabase", "db", "push"], env={"SUPABASE_DB_PASSWORD": db_pass}):
        print("\n❌ DB Push failed.")
        print("💡 NOTE: If you see 'permission denied to alter role', this is a known Supabase CLI bug.")
        print("   If it persists, please use the direct SQL script: scripts/apply_migration.py")
        return

    print("\n✅ Supabase CLI flow completed successfully!")

if __name__ == "__main__":
    main()
