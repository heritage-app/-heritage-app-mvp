import logging
import hashlib
import json
import inspect
from functools import wraps
from typing import Any, Callable, Optional
from cachetools import TTLCache

logger = logging.getLogger(__name__)

# Default translation cache: 1000 items, expires in 24 hours
translation_cache = TTLCache(maxsize=1000, ttl=86400)

# Default LLM response cache: 500 items, expires in 1 hour
llm_cache = TTLCache(maxsize=500, ttl=3600)

def generate_cache_key(prefix: str, *args, **kwargs) -> str:
    """Generate a stable cache key from arguments."""
    # Convert args and kwargs to a stable string
    key_content = {
        "args": [str(a) for a in args],
        "kwargs": {k: str(v) for k, v in sorted(kwargs.items())}
    }
    key_str = json.dumps(key_content, sort_keys=True)
    return f"{prefix}:{hashlib.sha256(key_str.encode()).hexdigest()}"

def cached_translation(func: Callable):
    """Decorator to cache translation results."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        key = generate_cache_key("trans", *args, **kwargs)
        if key in translation_cache:
            logger.info(f"CACHE HIT: Translation [{key}]")
            return translation_cache[key]
        
        result = func(*args, **kwargs)
        translation_cache[key] = result
        return result
    return wrapper

def cached_llm_response(namespace: str):
    """
    Decorator to cache LLM responses.
    Useful for common questions that don't change often.
    """
    def decorator(func: Callable):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # We only cache non-streaming responses for now
            if kwargs.get("stream", False):
                return await func(*args, **kwargs)
                
            key = generate_cache_key(f"llm:{namespace}", *args, **kwargs)
            if key in llm_cache:
                logger.info(f"CACHE HIT: LLM [{key}]")
                return llm_cache[key]
            
            result = await func(*args, **kwargs)
            llm_cache[key] = result
            return result
            
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            key = generate_cache_key(f"llm:{namespace}", *args, **kwargs)
            if key in llm_cache:
                logger.info(f"CACHE HIT: LLM [{key}]")
                return llm_cache[key]
            
            result = func(*args, **kwargs)
            llm_cache[key] = result
            return result
            
        return async_wrapper if func.__name__.startswith("a") or "async" in str(type(func)) else sync_wrapper
    return decorator
