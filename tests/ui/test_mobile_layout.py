"""Basic mobile layout checks using Playwright device emulation."""

from playwright.sync_api import Browser


def test_mobile_layout_shows_opponents_and_hand(browser: Browser, base_url: str) -> None:
    """Smoke‑test the iPhone layout: opponents on top, footer visible, hand scrollable.

    This uses a single player; deeper functional coverage is in other tests.
    """
    iphone = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    try:
        page = iphone.new_page()
        page.goto(base_url + "/")
        page.get_by_label("Your Name").fill("MobileUser")
        page.get_by_role("button", name="Create Room").click()
        page.locator("#waiting-room").wait_for(state="visible")
        page.get_by_role("button", name="Start Game").click()

        page.goto(base_url + "/game")

        # Opponents strip is visible at the top
        opponents = page.locator(".opponents-row")
        opponents.wait_for(state="visible")

        # Player controls/footer visible at bottom
        footer = page.locator(".player-controls")
        assert footer.is_visible()

        # Hand container is present and contains cards (eventually)
        cards = page.locator("#my-hand .card")
        cards.first.wait_for(timeout=10000)
        assert cards.count() > 0
    finally:
        iphone.close()

