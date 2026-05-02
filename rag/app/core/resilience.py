import logging
import time
from functools import wraps
from typing import Any, Callable, TypeVar
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Retry settings for DB connections (Mongo, Qdrant)
retry_db = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((ConnectionError, TimeoutError, Exception)),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)

# Retry settings for LLM API calls (OpenRouter, Google)
retry_llm = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    # We catch broad exceptions for LLMs as they often return generic errors or timeouts
    retry=retry_if_exception_type(Exception), 
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)

def instrument_time(name: str):
    """
    Decorator to log execution time of a function.
    Useful for identifying bottlenecks (e.g., Retrieval vs LLM).
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        if name.startswith("async_") or "ask" in func.__name__:
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                start = time.perf_counter()
                try:
                    return await func(*args, **kwargs)
                finally:
                    end = time.perf_counter()
                    logger.info(f"PERF: [{name}] took {end - start:.4f}s")
            return async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                start = time.perf_counter()
                try:
                    return func(*args, **kwargs)
                finally:
                    end = time.perf_counter()
                    logger.info(f"PERF: [{name}] took {end - start:.4f}s")
            return sync_wrapper
    return decorator
