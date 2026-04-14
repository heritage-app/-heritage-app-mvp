"""
Dependencies for FastAPI routes.
Handles authentication and current user extraction from Custom JWT.
"""
import jwt
from fastapi import Depends, HTTPException, status, Header, Request
from app.core.config import settings
from app.storage.repositories.users import UserRepository

async def get_current_user(request: Request) -> any:
    """
    Verifies the custom JWT natively from the HttpOnly Cookie.
    """
    token_str = request.cookies.get("access_token")
    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing",
        )
        
    try:
        payload = jwt.decode(
            token_str, 
            settings.jwt_secret_key, 
            algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )
            
        # Fetch the user from MongoDB
        user = await UserRepository.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
            
        return user
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal authentication system error: {str(e)}",
        )

async def get_optional_user(
    request: Request,
    x_anonymous_id: str | None = Header(None, alias="X-Anonymous-ID")
) -> str | None:
    """
    Attempts to decode custom JWT if present in cookies. 
    If token is missing, returns x_anonymous_id (prefixed with guest_) from headers.
    """
    token_str = request.cookies.get("access_token")
    if token_str and token_str != "null" and token_str != "undefined":
        try:
            # Re-use the robust validation from get_current_user
            user = await get_current_user(request)
            return str(user["_id"])
        except Exception:
            pass
            
    # If it's a guest ID, ensure it has a unique prefix
    # identify guests in route logic without doing regex.
    if x_anonymous_id:
        if not x_anonymous_id.startswith("guest_"):
            return f"guest_{x_anonymous_id}"
        return x_anonymous_id
        
    return None

async def get_current_admin(user: any = Depends(get_current_user)) -> str:
    """
    Dependency that ensures the current user is an admin.
    Checks the user's role from MongoDB, then falls back to settings.admin_user_ids.
    """
    user_id = str(user["_id"])
    allowed = False
    
    # 1. Check database-driven role (attached natively to our user document now)
    if user.get("role") == "admin":
        allowed = True
        
    # 2. Check legacy whitelist (Failsafe/Bootstrap)
    if not allowed and user_id in settings.admin_user_ids:
        allowed = True
        
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: User does not have administrative privileges."
        )
        
    return user_id
