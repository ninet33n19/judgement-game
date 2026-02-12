import os
import uvicorn

# Re-export for ASGI/uvicorn: "main:app" (e.g. Railway default)
from src.judgement.main import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(
        "src.judgement.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )