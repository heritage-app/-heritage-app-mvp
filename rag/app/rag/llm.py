from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings


def get_llm(temperature: float = 0.7, streaming: bool = True, model: str = None, **kwargs) -> ChatOpenAI | ChatGoogleGenerativeAI:
    """
    Get LLM instance (Google Gemini or OpenRouter).
    
    Args:
        temperature: Sampling temperature
        streaming: Whether to enable streaming
        model: Optional model override (e.g. 'gemini-2.0-flash' or 'meta-llama/llama-3-8b-instruct')
        **kwargs: Additional parameters for the LLM
        
    Returns:
        ChatOpenAI or ChatGoogleGenerativeAI instance
    """
    # 1. Determine provider and model_id
    effective_model = model or (settings.gemini_model if settings.llm_provider == "google" else settings.openrouter_model)
    
    # If model is explicitly passed and contains 'gemini' or starts with 'models/', assume Google
    is_google = settings.llm_provider == "google"
    if model and ("gemini" in model.lower() or model.startswith("models/")):
        is_google = True
    elif model and ("/" in model or "llama" in model.lower()):
        is_google = False
        
    # 2. Return appropriate LLM instance
    if is_google:
        return ChatGoogleGenerativeAI(
            model=effective_model,
            google_api_key=settings.google_api_key,
            temperature=temperature,
            streaming=streaming,
            **kwargs
        )
    else:
        return ChatOpenAI(
            model=effective_model,
            openai_api_key=settings.openrouter_api_key,
            openai_api_base=settings.openrouter_base_url,
            temperature=temperature,
            streaming=streaming,
            max_tokens=None,
            **kwargs
        )

