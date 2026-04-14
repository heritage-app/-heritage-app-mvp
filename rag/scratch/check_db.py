import asyncio
import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load env from the backend directory
load_dotenv(dotenv_path="c:/Users/pc/Desktop/projects/work-projects/-heritage-app-mvp/rag/.env")

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") # Use Service Role to bypass RLS for diagnosis

async def check_profile():
    if not url or not key:
        print("Missing Supabase credentials in .env")
        return

    supabase: Client = create_client(url, key)
    
    target_id = "cf14e133-d83b-4ec1-b618-1dcead6c914e"
    print(f"Checking profile for ID: {target_id}...")
    
    try:
        response = supabase.table("profiles").select("*").eq("id", target_id).execute()
        if response.data:
            print(f"✅ FOUND: {response.data}")
        else:
            print("❌ NOT FOUND in 'profiles' table.")
            
        # Also check auth.users indirectly if possible, or just list a few profiles
        print("\nListing first 5 profiles:")
        all_profiles = supabase.table("profiles").select("id, email, role").limit(5).execute()
        for p in all_profiles.data:
            print(f" - {p['email']} ({p['role']}): {p['id']}")
            
    except Exception as e:
        print(f"🔥 ERROR: {str(e)}")

if __name__ == "__main__":
    asyncio.run(check_profile())
