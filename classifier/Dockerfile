# T-Gate classifier inference service (CPU).
# Build from the classifier/ dir after training:  docker build -t tgate-classifier .
FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 HF_HOME=/opt/hf
WORKDIR /app

RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY service/requirements.txt .
RUN pip install -r requirements.txt

# Bake the MiniLM weights into the image so startup needs no network.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

COPY service/ ./service/
COPY artifacts/head.joblib artifacts/model.json ./artifacts/

ENV CLASSIFIER_ARTIFACTS=/app/artifacts HF_HUB_OFFLINE=1
EXPOSE 8000
CMD ["uvicorn", "service.app:app", "--host", "0.0.0.0", "--port", "8000"]
