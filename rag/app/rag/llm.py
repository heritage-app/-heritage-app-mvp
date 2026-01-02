"""
OpenRouter LLM module using LangChain.
Handles LLM initialization and streaming support.
"""

from langchain_openai import ChatOpenAI

from app.core.config import settings


def get_llm(temperature: float = 0.7, streaming: bool = True) -> ChatOpenAI:
    """
    Get OpenRouter LLM instance via LangChain (OpenAI-compatible API).
    
    Args:
        temperature: Sampling temperature
        streaming: Whether to enable streaming
        
    Returns:
        ChatOpenAI: LangChain ChatOpenAI instance configured for OpenRouter
    """
    return ChatOpenAI(
        model=settings.openrouter_model,
        openai_api_key=settings.openrouter_api_key,
        openai_api_base=settings.openrouter_base_url,
        temperature=temperature,
        streaming=streaming,
        max_tokens=None
    )

