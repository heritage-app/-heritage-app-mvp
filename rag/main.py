"""
Entry point for running the application directly.
Usage: python main.py or uv run python main.py
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8080,
        reload=True
    )
