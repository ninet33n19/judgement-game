"""Playwright UI tests for the lobby / waiting‑room flow."""

from playwright.sync_api import Page


def _enter_name_and_create_room(page: Page, name: str) -> None:
    page.get_by_label("Your Name").fill(name)
    page.get_by_role("button", name="Create Room").click()


def test_create_room_and_waiting_room(lobby_page: Page) -> None:
    """User can create a room and see the waiting room UI."""
    _enter_name_and_create_room(lobby_page, "Host")

    # Waiting room section becomes visible
    waiting_room = lobby_page.locator("#waiting-room")
    waiting_room.wait_for(state="visible")

    # Room code is displayed
    code = lobby_page.locator("#display-room-code")
    assert code.inner_text().strip() != ""

    # Player list contains the host with (You)
    players = lobby_page.locator("#player-list li")
    players.first.wait_for()
    assert "(You)" in players.first.inner_text()


def test_join_room_shows_players(lobby_page: Page, new_context, base_url: str) -> None:
    """Second player joins the same room and both names are shown."""
    _enter_name_and_create_room(lobby_page, "Host")
    lobby_page.locator("#waiting-room").wait_for(state="visible")
    room_code = lobby_page.locator("#display-room-code").inner_text().strip()

    # Second player in a separate context
    page2 = new_context.new_page()
    page2.goto(base_url + "/")
    page2.get_by_label("Your Name").fill("Guest")
    page2.get_by_placeholder("Room Code").fill(room_code)
    page2.get_by_role("button", name="Join Room").click()

    # Both players should now appear in the host's list
    lobby_page.reload(wait_until="networkidle")
    items = lobby_page.locator("#player-list li")
    items.nth(1).wait_for()
    texts = [items.nth(i).inner_text() for i in range(items.count())]
    assert any("Host" in t for t in texts)
    assert any("Guest" in t for t in texts)

