.PHONY: install backend frontend test lint
install:
	cd backend && poetry install && poetry run pip install -r requirements-integrations.txt -r requirements-dev.txt
	cd frontend && npm ci
backend:
	cd backend && poetry run python homehub/manage.py migrate && poetry run python homehub/manage.py runserver 0.0.0.0:8000
frontend:
	cd frontend && npm run dev
test:
	cd backend && poetry run pytest
	cd frontend && npm test
lint:
	cd backend && poetry run ruff check homehub --select E9,F
	cd frontend && npm run lint
