.PHONY: help build run test clean docker-build docker-run docker-stop deploy

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build the Docker image
	docker build -t heritage-rag-api:latest .

run: ## Run the application locally
	uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

test: ## Run tests
	pytest -v --tb=short

test-cov: ## Run tests with coverage
	pytest -v --tb=short --cov=app --cov-report=term --cov-report=html

clean: ## Clean Python cache files
	find . -type d -name __pycache__ -exec rm -r {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type d -name "*.egg-info" -exec rm -r {} + 2>/dev/null || true
	rm -rf .pytest_cache .coverage htmlcov dist build

docker-build: ## Build Docker image
	docker build -t heritage-rag-api:latest .

docker-run: ## Run Docker container locally
	docker run -d \
		--name heritage-rag-api \
		--restart unless-stopped \
		-p 8000:8000 \
		--env-file .env \
		-v $(PWD)/data:/app/data \
		heritage-rag-api:latest

docker-stop: ## Stop Docker container
	docker stop heritage-rag-api || true
	docker rm heritage-rag-api || true

docker-logs: ## View Docker container logs
	docker logs -f heritage-rag-api

docker-compose-up: ## Start services with docker-compose
	docker-compose up -d

docker-compose-down: ## Stop services with docker-compose
	docker-compose down

docker-compose-logs: ## View docker-compose logs
	docker-compose logs -f

lint: ## Run linters (if configured)
	@echo "Linting not configured yet"

format: ## Format code (if configured)
	@echo "Formatting not configured yet"

install: ## Install dependencies
	uv pip install --system -r pyproject.toml

install-dev: ## Install development dependencies
	uv pip install --system pytest pytest-asyncio httpx pytest-cov
	uv pip install --system -r pyproject.toml

