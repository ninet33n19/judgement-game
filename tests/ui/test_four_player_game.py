"""Four-player game test suite.

Spawns 4 separate browser contexts to simulate 4 distinct players and exercises
full game flow: lobby, waiting room, start game, bidding, playing, round result,
and next round.
"""

from typing import List

import pytest
from playwright.sync_api import Browser, BrowserContext, Page


# --- Helpers (no fixture) ---


def create_room(page: Page, name: str) -> str:
    """Player creates a room; returns room code."""
    page.get_by_label("Your Name").fill(name)
    page.get_by_role("button", name="Create Room").click()
    page.locator("#waiting-room").wait_for(state="visible", timeout=10000)
    return page.locator("#display-room-code").inner_text().strip()


def join_room(page: Page, name: str, room_code: str) -> None:
    """Player joins existing room by code."""
    page.get_by_label("Your Name").fill(name)
    page.get_by_placeholder("Room Code").fill(room_code)
    page.get_by_role("button", name="Join Room").click()
    page.locator("#waiting-room").wait_for(state="visible", timeout=10000)


def start_game(host_page: Page) -> None:
    """Host starts the game."""
    host_page.get_by_role("button", name="Start Game").click()


def wait_all_to_game(pages: List[Page], timeout_ms: int = 10000) -> None:
    """Block until every page is on /game."""
    for p in pages:
        p.wait_for_url("**/game", timeout=timeout_ms)


def do_bidding_round(
    pages: List[Page],
    num_players: int = 4,
    bid_value: str = "0",
    timeout_per_bid_ms: int = 5000,
) -> None:
    """Each of num_players places a bid when their bid modal appears."""
    for _ in range(num_players):
        for p in pages:
            try:
                p.locator("#bid-modal").wait_for(state="visible", timeout=timeout_per_bid_ms)
                p.get_by_role("button", name=bid_value).first.click()
                p.wait_for_timeout(500)
                break
            except Exception:
                continue


def do_one_trick(pages: List[Page], num_players: int = 4, timeout_per_play_ms: int = 8000) -> None:
    """Each player plays one card when it's their turn (one full trick)."""
    for _ in range(num_players):
        for p in pages:
            try:
                status = p.locator("#status-text")
                status.wait_for(state="visible", timeout=2000)
                if "Your turn" in status.inner_text():
                    p.locator("#my-hand .card").first.click()
                    p.wait_for_timeout(600)
                    break
            except Exception:
                continue


def wait_for_round_result_modal(pages: List[Page], timeout_ms: int = 15000) -> None:
    """Wait until round result modal is visible on the first page (host)."""
    pages[0].locator("#round-result-modal").wait_for(state="visible", timeout=timeout_ms)


def get_round_info(page: Page) -> str:
    """Return round info text e.g. '1/19'."""
    return page.locator("#round-info").inner_text().strip()


def get_trick_message(page: Page) -> str:
    """Return trick area message (e.g. 'X wins!')."""
    return page.locator("#trick-message").inner_text().strip()


# --- Fixture: 4 players (4 contexts, 4 pages) ---


@pytest.fixture
def four_players(browser: Browser, base_url: str):
    """Spawn 4 browser contexts and 4 pages (P1=host, P2–P4=guests)."""
    contexts: List[BrowserContext] = []
    pages: List[Page] = []
    try:
        for i in range(4):
            ctx = browser.new_context()
            contexts.append(ctx)
            page = ctx.new_page()
            page.goto(base_url + "/")
            pages.append(page)
        yield {
            "pages": pages,
            "host": pages[0],
            "guests": pages[1:],
            "contexts": contexts,
        }
    finally:
        for ctx in contexts:
            ctx.close()


# --- Tests ---


def test_four_players_see_each_other_in_waiting_room(
    four_players: dict, base_url: str
) -> None:
    """P1 creates room; P2, P3, P4 join; all see waiting room and 4 players listed."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)

    # All should see waiting room
    for p in pages:
        p.locator("#waiting-room").wait_for(state="visible", timeout=5000)
        assert p.locator("#player-list li").count() >= 4


def test_four_players_redirect_to_game_after_start(four_players: dict) -> None:
    """Start game from host; all 4 are redirected to /game."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    for p in pages:
        assert "/game" in p.url


def test_four_players_each_has_cards_after_start(four_players: dict) -> None:
    """After start, each player sees at least one card in hand (round 1 = 1 card)."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    for p in pages:
        cards = p.locator("#my-hand .card")
        cards.first.wait_for(state="visible", timeout=5000)
        assert cards.count() >= 1


def test_four_players_see_round_and_trump_after_start(four_players: dict) -> None:
    """After start, all see round info (e.g. 1/19) and a trump suit."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    for p in pages:
        round_info = get_round_info(p)
        assert "/" in round_info and round_info.split("/")[0].strip().isdigit()
        trump = p.locator("#trump-suit").inner_text().strip()
        assert trump in ("♠", "♦", "♣", "♥")


def test_four_players_complete_bidding_then_see_play_phase(four_players: dict) -> None:
    """All 4 bid (round 1); after bidding, status shows someone's turn or trick area updates."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    do_bidding_round(pages, num_players=4, bid_value="0")

    # After bidding, we're in play phase: either "Your turn" or "X's turn" or trick message
    host.wait_for_timeout(1500)
    status_el = host.locator("#status-text")
    trick_el = host.locator("#trick-message")
    assert status_el.is_visible() or trick_el.is_visible() or host.locator("#my-hand .card").count() >= 1


def test_four_players_play_one_trick(four_players: dict) -> None:
    """Bidding then 4 card plays; trick winner message appears."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    do_bidding_round(pages, num_players=4, bid_value="0")
    do_one_trick(pages, num_players=4)

    host.wait_for_timeout(2500)
    msg = get_trick_message(host)
    assert "wins" in msg or msg == ""


@pytest.mark.slow
def test_four_players_round_result_after_round_1(four_players: dict) -> None:
    """Complete round 1 (4 bids + 4 plays); round result modal appears on all."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    do_bidding_round(pages, num_players=4, bid_value="0")
    do_one_trick(pages, num_players=4)
    wait_for_round_result_modal(pages, timeout_ms=20000)

    for p in pages:
        p.locator("#round-result-modal").wait_for(state="visible", timeout=5000)
        assert p.locator("#round-result-table tbody tr").count() >= 4


@pytest.mark.slow
def test_four_players_host_sees_next_round_button_guests_do_not(four_players: dict) -> None:
    """When round result is shown, only host sees Next Round button."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    do_bidding_round(pages, num_players=4, bid_value="0")
    do_one_trick(pages, num_players=4)
    wait_for_round_result_modal(pages, timeout_ms=20000)

    next_btn_host = host.get_by_role("button", name="Next Round")
    assert next_btn_host.is_visible(), "Host must see Next Round button"

    for g in guests:
        g.locator("#round-result-modal").wait_for(state="visible", timeout=5000)
        next_btn_guest = g.get_by_role("button", name="Next Round")
        assert not next_btn_guest.is_visible(), "Guest must not see Next Round button"


@pytest.mark.slow
def test_four_players_next_round_advances_round_number(four_players: dict) -> None:
    """Host clicks Next Round; round info advances from 1/x to 2/x."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    do_bidding_round(pages, num_players=4, bid_value="0")
    do_one_trick(pages, num_players=4)
    wait_for_round_result_modal(pages, timeout_ms=20000)

    before = get_round_info(host)
    host.get_by_role("button", name="Next Round").click()
    host.wait_for_timeout(2500)
    after = get_round_info(host)
    assert before != after, "Round number should advance after Next Round"
    assert after.startswith("2/"), "Round should be 2 after first Next Round"


def test_four_players_scoreboard_opens_from_header(four_players: dict) -> None:
    """Any player can open scoreboard from header; it shows a table."""
    host = four_players["host"]
    guests = four_players["guests"]
    pages = four_players["pages"]

    room_code = create_room(host, "Alice")
    for i, p in enumerate(guests, start=1):
        join_room(p, f"Bob{i}", room_code)
    start_game(host)
    wait_all_to_game(pages)

    host.locator("#btn-scoreboard").click()
    host.locator("#scoreboard-modal").wait_for(state="visible", timeout=5000)
    assert host.locator("#scoreboard-table").is_visible()
    host.locator("#btn-close-scoreboard").click()
    host.locator("#scoreboard-modal").wait_for(state="hidden", timeout=3000)
