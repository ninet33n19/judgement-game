FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY . .

RUN pip install --no-cache-dir uv && \
    uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uvicorn", "src.judgement.main:app", "--host", "0.0.0.0", "--port", "8000"]
