## Testing

This project includes both backend unit tests and browser-based UI tests.

### 1. Install test dependencies

From the project root:

```bash
pip install .[dev]
```

Playwright also needs browsers installed once:

```bash
playwright install
```

### 2. Backend tests (fast)

Run pure logic and WebSocket‑level tests:

```bash
pytest tests/backend
```

### 3. UI / end‑to‑end tests

The UI tests assume the app is already running locally:

```bash
python main.py
# in another terminal:
pytest tests/ui -k "game"
```

The suite includes:

- Lobby and waiting‑room flows (`tests/ui/test_lobby.py`)
- Basic game‑round flows and host \"Next Round\" behaviour (`tests/ui/test_game_flow.py`)
- A simple mobile/iPhone layout smoke test (`tests/ui/test_mobile_layout.py`)

