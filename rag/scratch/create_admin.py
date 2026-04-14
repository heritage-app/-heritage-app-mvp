import asyncio
import sys
import os

# Ensure the app context is available
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.storage.repositories.users import UserRepository
from app.api.routers.auth import get_password_hash

async def main():
    email = "admin@ekowlabs.space"
    password = "admin.password123" 
    
    try:
        # Check if user already exists to prevent crashing
        existing = await UserRepository.get_user_by_email(email)
        if existing:
            # Promote to admin if already exists
            collection = await UserRepository.get_collection()
            await collection.update_one({"_id": existing["_id"]}, {"$set": {"role": "admin"}})
            print(f"Admin promoted: {email} / (password unchanged)")
            return
            
        hashed_pwd = get_password_hash(password)
        user = await UserRepository.create_user(
            email=email,
            hashed_password=hashed_pwd,
            role="admin",
            display_name="Heritage Administrator"
        )
        print(f"SUCCESS: Admin account created:")
        print(f"Email: {user['email']}")
        print(f"Password: {password}")
        
    except Exception as e:
        print(f"ERROR: Failed to create admin: {e}")

if __name__ == "__main__":
    asyncio.run(main())
