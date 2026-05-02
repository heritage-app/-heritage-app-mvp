"""
Custom Authentication Router using MongoDB and JWT.
Replaces Supabase GoTrue Auth.
"""
from datetime import datetime, timedelta
from typing import Optional, Any
import jwt
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from pydantic import BaseModel, EmailStr

from app.core.config import settings
from app.storage.repositories.users import UserRepository
from app.api.deps import get_current_user

router = APIRouter()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Truncate to 72 bytes (bcrypt limit)
    password_bytes = plain_password.encode('utf-8')[:72]
    return bcrypt.checkpw(password_bytes, hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    # Truncate to 72 bytes (bcrypt limit) and decode to store as string in MongoDB
    password_bytes = password.encode('utf-8')[:72]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode('utf-8')

def create_access_token(subject: str, role: str, expires_delta: timedelta) -> str:
    """Create a PyJWT access token containing user identity and role."""
    expire = datetime.utcnow() + expires_delta
    to_encode = {"exp": expire, "sub": str(subject), "role": role}
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return encoded_jwt

# -- Schemas --
class AuthRequest(BaseModel):
    email: EmailStr
    password: str
    
class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserProfile(BaseModel):
    id: str
    email: str
    role: str
    display_name: str

# -- Endpoints --

@router.post("/signup", response_model=AuthResponse)
async def signup(body: AuthRequest, response: Response):
    # 1. Check if user already exists
    existing_user = await UserRepository.get_user_by_email(body.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists"
        )
        
    # 2. Hash password & save
    hashed_pwd = get_password_hash(body.password)
    new_user = await UserRepository.create_user(body.email, hashed_pwd)
    
    # 3. Create token
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        subject=new_user["_id"],
        role=new_user["role"],
        expires_delta=access_token_expires
    )
    
    # 4. Set HttpOnly Cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True, 
        samesite="lax", # Strict can sometimes block local dev navigation
        max_age=settings.access_token_expire_minutes * 60
    )
    
    user_data = {
        "id": new_user["_id"],
        "email": new_user["email"],
        "role": new_user["role"],
        "display_name": new_user["display_name"],
    }
    
    return {"access_token": access_token, "user": user_data}


@router.post("/login", response_model=AuthResponse)
async def login(body: AuthRequest, response: Response):
    # 1. Look up user
    user = await UserRepository.get_user_by_email(body.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
        
    # 2. Verify password
    if not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
        
    # 3. Issue token
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        subject=user["_id"],
        role=user["role"],
        expires_delta=access_token_expires
    )
    
    # 4. Set HttpOnly Cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True, 
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60
    )
    
    user_data = {
        "id": user["_id"],
        "email": user["email"],
        "role": user["role"],
        "display_name": user["display_name"],
    }
    
    return {"access_token": access_token, "user": user_data}

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(
        key="access_token",
        httponly=True,
        secure=True,
        samesite="lax"
    )
    return {"status": "success", "message": "Logged out"}


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: Any = Depends(get_current_user)):
    """Fetch current user profile using the token attached via Bearer scheme or Cookie."""
    return {
        "id": current_user["_id"],
        "email": current_user["email"],
        "role": current_user["role"],
        "display_name": current_user["display_name"],
    }
