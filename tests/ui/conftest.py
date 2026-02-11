"""Common Playwright fixtures for UI tests.

These tests assume the app is already running locally on http://localhost:8000
(for example via ``python main.py`` in another terminal).

If you later want to start/stop uvicorn programmatically for tests, this
is the place to add that fixture.
"""

import socket
import threading
import time

import pytest
import uvicorn
from playwright.sync_api import Page, BrowserContext

from src.judgement.main import app


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def app_server() -> str:
    """Start the FastAPI app in a background uvicorn server for UI tests."""
    port = _get_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Wait briefly for server to come up
    base_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                break
        except OSError:
            time.sleep(0.1)

    yield base_url

    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="session")
def base_url(app_server: str) -> str:
    """Base URL for the running app.

    Session scope keeps it compatible with pytest-base-url, which also
    expects a session-scoped ``base_url`` fixture.
    """
    return app_server


@pytest.fixture
def lobby_page(page: Page, base_url: str) -> Page:
    page.goto(base_url + "/")
    return page


@pytest.fixture
def new_context(browser) -> BrowserContext:  # type: ignore[no-redef]
    """Convenience fixture for spawning extra players in separate contexts."""
    context = browser.new_context()
    try:
        yield context
    finally:
        context.close()

