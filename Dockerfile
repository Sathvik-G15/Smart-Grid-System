# Stage 1: Build the React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy frontend package files and install dependencies
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

# Copy the rest of the frontend source code and build
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the FastAPI Backend and serve the built frontend
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code and ML artifacts
COPY backend/ ./backend/
COPY ml/ ./ml/
# Also need to copy any dataset if the backend relies on it directly, 
# but main.py looks for artifacts in backend/ and ml/ directories.

# Copy the built frontend static files from the first stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose the port the app runs on
EXPOSE 8000

# Set the working directory to backend so relative paths work
WORKDIR /app/backend

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
