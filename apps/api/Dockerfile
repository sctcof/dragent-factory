FROM python:3.11-slim
WORKDIR /app
COPY apps/api/requirements.txt /app/apps/api/requirements.txt
RUN pip install --no-cache-dir -r /app/apps/api/requirements.txt
COPY apps /app/apps
COPY packages /app/packages
COPY docs /app/docs
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uvicorn", "apps.api.dragent_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
