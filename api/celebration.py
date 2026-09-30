"""Celeste Daily private October 2026, Rs. 265M milestone display.

Vercel Python BaseHTTPRequestHandler; no third-party dependencies.
Never expose Odoo credentials to HTML, JS, cookies, or API responses.
"""

from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import hmac
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from http import cookies
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

LOG = logging.getLogger(__name__)
ASSETS = Path(__file__).resolve().parent / "celebration_assets"
TZ = timezone(timedelta(hours=5, minutes=30))
EVENT_START = date(2026, 10, 1)
EVENT_LAST_DAY = date(2026, 10, 31)
EVENT_END = datetime(2026, 11, 1, tzinfo=TZ)
TARGET = Decimal("265000000.00")
EVENT_KEY = "CELESTE_OCTOBER_265_MILLION"
COOKIE_NAME = "celeste_265m_oct_event"  # Separate from September sessions.
COOKIE_MAX_AGE = 86400
SOURCE_CACHE_SECONDS = 25  # Per warm Vercel instance; today remains directly Odoo-driven.
HISTORY_CACHE_SECONDS = 900  # Reverify completed-day sales every <=15 min per warm instance.
MAX_SOURCE_AGE_SECONDS = 180
MAX_HISTORY_AGE_SECONDS = 1200
_today_lock = threading.Lock()
_history_lock = threading.Lock()
_cache = None
_cache_until = 0.0
_history_cache = None
_history_cache_until = 0.0


def now_local() -> datetime:
    return datetime.now(TZ)


def _required_env(name: str, minimum: int = 1) -> str:
    value = os.environ.get(name, "").strip()
    if len(value) < minimum:
        raise RuntimeError(f"Required celebration configuration is missing/too short: {name}")
    return value


def _access_settings() -> tuple[str, bytes]:
    return (
        _required_env("CELEBRATION_ACCESS_PASSWORD", minimum=16),
        _required_env("CELEBRATION_SESSION_SECRET", minimum=32).encode("utf-8"),
    )


def _event_open() -> bool:
    return EVENT_START <= now_local().date() <= EVENT_LAST_DAY


def _session_token(secret: bytes) -> tuple[str, int]:
    # Sessions expire at each Colombo midnight (re-login daily) and at event end.
    now = now_local()
    midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=TZ)
    remaining = int((min(EVENT_END, midnight) - now).total_seconds())
    if remaining <= 0 or not _event_open():
        raise RuntimeError("October celebration campaign is not active.")
    lifetime = min(COOKIE_MAX_AGE, remaining)
    expiry = int(time.time()) + lifetime
    body = f"v1.{expiry}"
    digest = hmac.new(secret, body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{digest}", lifetime


def _session_valid(header: str, secret: bytes) -> bool:
    if not _event_open():
        return False
    jar = cookies.SimpleCookie()
    try:
        jar.load(header)
        token = jar[COOKIE_NAME].value
        version, expiry, signature = token.split(".")
        if version != "v1" or not expiry.isascii() or not expiry.isdecimal():
            return False
        if len(signature) != 64 or not all(ch in "0123456789abcdef" for ch in signature):
            return False
        issued_expiry = int(expiry)
        today_midnight = datetime.combine(now_local().date() + timedelta(days=1), datetime.min.time(), tzinfo=TZ)
        if not (time.time() < issued_expiry <= min(EVENT_END, today_midnight).timestamp() + 1):
            return False
        expected = hmac.new(secret, f"v1.{expiry}".encode("ascii"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)
    except (KeyError, ValueError, cookies.CookieError):
        return False


def _money(value, field: str) -> Decimal:
    try:
        number = Decimal(str(value if value is not None else "0"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Invalid Odoo {field} value") from exc
    if not number.is_finite() or number < 0:
        raise ValueError(f"Invalid Odoo {field} value")
    return number


def _order_count(value) -> int:
    try:
        orders = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Invalid Odoo order_count") from exc
    if orders < 0 or _money(value, "order_count") != Decimal(orders):
        raise ValueError("Invalid Odoo order_count")
    return orders


def _validated_sales(dashboard: dict) -> tuple[Decimal, int]:
    # Exact same governed Odoo model/method and single-day inputs as the
    # Celeste Intelligence LIVE Management Dashboard sales source.
    if not isinstance(dashboard, dict):
        raise ValueError("Invalid Odoo Management Dashboard response")
    comparison = dashboard.get("sales_comparison")
    day = comparison.get("today") if isinstance(comparison, dict) else None
    if not isinstance(day, dict) or "sale_value" not in day or "order_count" not in day:
        raise ValueError("Odoo Management Dashboard sales contract is missing")
    sales = _money(day["sale_value"], "sales_comparison.today.sale_value")
    orders = _order_count(day["order_count"])

    hourly = dashboard.get("hourly_trends") or {}
    locations = dashboard.get("location_performance") or {}
    if not isinstance(hourly, dict) or not isinstance(locations, dict):
        raise ValueError("Odoo Management Dashboard breakdown contract is invalid")
    for label, container, key in (
        ("hourly_trends", hourly, "total_sales"),
        ("location_performance", locations, "total_today"),
    ):
        if key in container and abs(_money(container[key], f"{label}.{key}") - sales) > Decimal("0.01"):
            raise ValueError(f"Odoo {label} sales do not match the management total")
    if "total_orders" in hourly and _order_count(hourly["total_orders"]) != orders:
        raise ValueError("Odoo hourly orders do not match the management order count")
    return sales.quantize(Decimal("0.01")), orders


def _fetch_dashboard(date_from: date, date_to: date) -> tuple[dict, datetime]:
    # The upstream model is read-only, with PickMe + Uber governed sales semantics.
    # Date range is intentionally not treated as a monthly sale_value aggregation:
    # independently verified: today => date_to; seven_day => 8 inclusive days.
    if not (date_from <= date_to <= EVENT_LAST_DAY):
        raise ValueError("Invalid governed Odoo date window")
    base = _required_env("ODOO_BASE_URL").rstrip("/")
    if not base.startswith("https://"):
        raise RuntimeError("ODOO_BASE_URL must use HTTPS")
    key = _required_env("ODOO_API_KEY")
    started = now_local()  # Conservative freshness timestamp, BEFORE upstream request.
    endpoint = base + "/json/2/celeste.management.dashboard/get_dashboard_data_for_client"
    payload = json.dumps({
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "sales_team_ids": [],
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=payload, method="POST",
        headers={
            "Authorization": "bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "CelesteDailyCelebration/2.0",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise ValueError("Unexpected Odoo HTTP status")
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Odoo response exceeds safe size limit")
    dashboard = json.loads(raw)
    _validated_sales(dashboard)  # Independently verifies today's hourly/location sums.
    return dashboard, started


def _verified_historical_part(window: tuple[date, date]) -> Decimal:
    start, end = window
    length = (end - start).days + 1
    if not 1 <= length <= 8 or start < EVENT_START:
        raise ValueError("Historical sales window is outside the October campaign")
    dashboard, _ = _fetch_dashboard(start, end)
    comparison = dashboard["sales_comparison"]
    today = _money(comparison["today"]["sale_value"], "today.sale_value")
    if length == 1:
        return today.quantize(Decimal("0.01"))
    if length == 2:
        yesterday = comparison.get("yesterday")
        if not isinstance(yesterday, dict) or "sale_value" not in yesterday:
            raise ValueError("Missing Odoo yesterday sale_value for two-day history")
        return (today + _money(yesterday["sale_value"], "yesterday.sale_value")).quantize(Decimal("0.01"))
    if length != 8:
        raise ValueError("Only 1, 2, and 8-day Odoo historical windows are verified")
    weekly = comparison.get("seven_day")
    if not isinstance(weekly, dict) or "sale_value" not in weekly:
        raise ValueError("Missing Odoo inclusive eight-day sale_value")
    value = _money(weekly["sale_value"], "seven_day.sale_value")
    if "pickme_value" in weekly and "uber_value" in weekly:
        channels = (
            _money(weekly["pickme_value"], "seven_day.pickme_value")
            + _money(weekly["uber_value"], "seven_day.uber_value")
        )
        if abs(channels - value) > Decimal("0.02"):
            raise ValueError("Eight-day Odoo channel sales failed parity validation")
    return value.quantize(Decimal("0.01"))


def _historical_windows(through: date) -> list[tuple[date, date]]:
    # Disjoint October-only partitions. No September sales can enter this total.
    # Eight-day windows are the user-verified *inclusive* Odoo seven_day contract.
    if through < EVENT_START:
        return []
    if through > EVENT_LAST_DAY:
        raise ValueError("Historical date exceeds October")
    cursor = EVENT_START
    windows = []
    while (through - cursor).days + 1 >= 8:
        end = cursor + timedelta(days=7)
        windows.append((cursor, end))
        cursor = end + timedelta(days=1)
    while cursor <= through:
        end = min(cursor + timedelta(days=1), through)
        windows.append((cursor, end))
        cursor = end + timedelta(days=1)
    return windows


def _verified_history(through: date) -> tuple[Decimal, datetime]:
    global _history_cache, _history_cache_until
    if through < EVENT_START:
        return Decimal("0.00"), now_local()
    now = now_local()
    if (_history_cache is not None and _history_cache["through"] == through
            and time.monotonic() < _history_cache_until
            and 0 <= (now - _history_cache["read_at"]).total_seconds() <= MAX_HISTORY_AGE_SECONDS):
        return _history_cache["amount"], _history_cache["read_at"]
    with _history_lock:
        now = now_local()
        if (_history_cache is not None and _history_cache["through"] == through
                and time.monotonic() < _history_cache_until
                and 0 <= (now - _history_cache["read_at"]).total_seconds() <= MAX_HISTORY_AGE_SECONDS):
            return _history_cache["amount"], _history_cache["read_at"]
        windows = _historical_windows(through)
        started = now_local()
        # Keep each Odoo call bounded, but parallelize independent date windows
        # so a serverless cold start does not request 30+ days sequentially.
        with ThreadPoolExecutor(max_workers=min(4, len(windows))) as pool:
            futures = [pool.submit(_verified_historical_part, window) for window in windows]
            parts = [future.result() for future in futures]
        result = sum(parts, Decimal("0.00")).quantize(Decimal("0.01"))
        if (now_local() - started).total_seconds() > MAX_HISTORY_AGE_SECONDS:
            raise ValueError("Historical Odoo evidence is too old")
        _history_cache = {"through": through, "amount": result, "read_at": started}
        _history_cache_until = time.monotonic() + HISTORY_CACHE_SECONDS
        return result, started


def _today_snapshot(business_day: date) -> tuple[Decimal, int, datetime]:
    global _cache, _cache_until
    with _today_lock:
        now = now_local()
        if (_cache is not None and _cache["day"] == business_day
                and time.monotonic() < _cache_until
                and 0 <= (now - _cache["source_time"]).total_seconds() <= MAX_SOURCE_AGE_SECONDS):
            return _cache["today"], _cache["orders"], _cache["source_time"]
        dashboard, started = _fetch_dashboard(business_day, business_day)
        today, orders = _validated_sales(dashboard)
        if (now_local() - started).total_seconds() > MAX_SOURCE_AGE_SECONDS:
            raise ValueError("Odoo current-day response is stale")
        _cache = {"day": business_day, "today": today, "orders": orders, "source_time": started}
        _cache_until = time.monotonic() + SOURCE_CACHE_SECONDS
        return today, orders, started


def celebration_snapshot() -> dict:
    if not _event_open():
        raise ValueError("October 2026 campaign is not active")
    business_day = now_local().date()
    yesterday = business_day - timedelta(days=1)
    # Historical and current-day reads are independently protected; a history
    # refresh cannot block a warm instance's regular today cache updates.
    with ThreadPoolExecutor(max_workers=2) as pool:
        history_future = pool.submit(_verified_history, yesterday)
        today_future = pool.submit(_today_snapshot, business_day)
        history, history_at = history_future.result()
        today, orders, read_at = today_future.result()
    current = now_local()
    if current.date() != business_day or not _event_open():
        raise ValueError("October campaign business date changed during upstream read")
    if (current - read_at).total_seconds() > MAX_SOURCE_AGE_SECONDS:
        raise ValueError("Odoo current-day response is stale")
    if (current - history_at).total_seconds() > MAX_HISTORY_AGE_SECONDS:
        raise ValueError("Odoo historical response is stale")
    monthly = (history + today).quantize(Decimal("0.01"))
    remaining = max(Decimal("0.00"), TARGET - monthly)
    above = max(Decimal("0.00"), monthly - TARGET)
    return {
        "event": EVENT_KEY,
        "business_date": business_day.isoformat(),
        "source": "ODOO_MANAGEMENT_DASHBOARD",
        "status": "LIVE",
        "historical_sales": float(history),
        "history_through": yesterday.isoformat() if yesterday >= EVENT_START else None,
        "history_verified_at": history_at.isoformat(),
        "history_max_age_seconds": MAX_HISTORY_AGE_SECONDS,
        "today_sales": float(today),
        "monthly_sales": float(monthly),
        "target": float(TARGET),
        "remaining": float(remaining),
        "above_target": float(above),
        "progress_percent": float(monthly / TARGET * Decimal("100")),
        "target_achieved": monthly >= TARGET,
        "order_count_today": orders,
        "live_read_at": read_at.isoformat(),
        "server_time": current.isoformat(),
        "deadline": EVENT_END.isoformat(),
    }


_LOGIN_HTML = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#090909">
<title>Celeste Daily | Celebration Access</title>
<link rel="stylesheet" href="/celebration/celebration.css"></head>
<body><main class="login-shell"><section class="login-card">
<div class="login-brand-visual" aria-label="Celeste Daily"><img class="brand-emblem" src="/celebration/emblem.png" alt="" width="46" height="46"><img class="brand-wordmark" src="/celebration/wordmark.png" alt="Celeste Daily" width="208" height="49"></div>
<div class="login-eyebrow">PRIVATE MILESTONE DISPLAY · OCTOBER 2026</div>
<h1>THE ROAD TO<br>265 MILLION.</h1>
<p>Enter your celebration access password to follow our live October milestone.</p>
{{ERROR}}<form method="post" action="/celebration/login" autocomplete="off">
<label for="password">ACCESS PASSWORD</label>
<input type="password" name="password" id="password" minlength="16" maxlength="256" required autocomplete="off" autofocus>
<button type="submit">OPEN LIVE CELEBRATION →</button></form>
<p class="login-foot">PRIVATE CELESTE TEAM VIEW · LIVE PICKME + UBER SALES</p>
</section></main></body></html>"""


class handler(BaseHTTPRequestHandler):
    def _headers(self, status: int, content_type: str, length: int, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "private, no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Vary", "Cookie")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; "
            "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        )
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self._headers(status, content_type, len(body), extra)
        self.wfile.write(body)

    def _json(self, status: int, result: dict) -> None:
        self._send(status, json.dumps(result, separators=(",", ":")).encode("utf-8"), "application/json; charset=utf-8")

    def _view(self) -> str:
        parts = urlsplit(self.path)
        selection = parse_qs(parts.query).get("view", [])
        if len(selection) == 1 and selection[0] in {"page", "css", "js", "data", "login", "logout", "emblem", "wordmark"}:
            return selection[0]
        # Local smoke tests / local direct invocation of this function.
        return {
            "/celebration": "page", "/celebration/": "page",
            "/celebration/celebration.css": "css", "/celebration/celebration.js": "js",
            "/celebration/emblem.png": "emblem", "/celebration/wordmark.png": "wordmark",
            "/celebration/api/sales": "data", "/celebration/login": "login",
            "/celebration/logout": "logout",
        }.get(parts.path, "unknown")

    def _authenticated(self) -> bool:
        try:
            _, secret = _access_settings()
        except RuntimeError:
            return False
        return _session_valid(self.headers.get("Cookie", ""), secret)

    def _login_page(self, error: bool = False) -> None:
        body = _LOGIN_HTML.replace(
            "{{ERROR}}",
            '<div class="login-error">Incorrect access password. Please try again.</div>' if error else "",
        ).encode("utf-8")
        self._send(403 if error else 200, body, "text/html; charset=utf-8")

    def _login_same_origin(self) -> bool:
        # Prevent cross-site form posts where Origin is provided by modern browsers.
        fetch_site = self.headers.get("Sec-Fetch-Site", "")
        if fetch_site and fetch_site not in ("same-origin", "none"):
            return False
        origin = self.headers.get("Origin", "")

        if origin.strip().lower() == "null":
            # Permit only browser-confirmed same-origin form navigation.
            # Cross-site and ambiguous fetch metadata remain rejected.
            return (
                fetch_site == "same-origin"
                and self.headers.get("Sec-Fetch-Mode", "").lower() == "navigate"
                and self.headers.get("Sec-Fetch-Dest", "").lower() == "document"
            )

        if not origin:
            return True

        uri = urlsplit(origin)
        if uri.scheme != "https":
            return False
        hosts = {
            value.lower() for value in (
                self.headers.get("Host", ""),
                self.headers.get("X-Forwarded-Host", ""),
                os.environ.get("VERCEL_URL", ""),
            ) if value
        }
        return uri.netloc.lower() in hosts

    def do_GET(self) -> None:
        view = self._view()
        if view in ("emblem", "wordmark"):
            # These static logos contain no private financial information.
            name = "_celeste_emblem.png" if view == "emblem" else "_celeste_wordmark.png"
            try:
                data = (ASSETS / name).read_bytes()
            except OSError:
                self._send(503, b"Logo unavailable", "text/plain; charset=utf-8")
                return
            self._send(200, data, "image/png")
            return
        if view in ("css", "js"):
            name = "_celebration_style.css" if view == "css" else "_celebration_client.js"
            try:
                data = (ASSETS / name).read_bytes()
            except OSError:
                self._send(503, b"Asset unavailable", "text/plain; charset=utf-8")
                return
            self._send(200, data, "text/css; charset=utf-8" if view == "css" else "application/javascript; charset=utf-8")
            return
        if view == "page":
            try:
                _access_settings()  # Fail closed if password/session settings are missing.
            except RuntimeError:
                self._send(503, b"Celebration access has not been configured.", "text/plain; charset=utf-8")
                return
            if not _event_open():
                self._send(409, b"The October 2026 campaign is not active.", "text/plain; charset=utf-8")
                return
            if not self._authenticated():
                self._login_page()
                return
            try:
                data = (ASSETS / "_celebration_page.html").read_bytes()
            except OSError:
                self._send(503, b"Celebration page unavailable", "text/plain; charset=utf-8")
                return
            self._send(200, data, "text/html; charset=utf-8")
            return
        if view == "data":
            if not self._authenticated():
                self._json(401, {"detail": "Celebration sign-in required"})
                return
            if not _event_open():
                self._json(409, {"detail": "The October 2026 campaign is not active"})
                return
            try:
                result = celebration_snapshot()
            except Exception:
                LOG.exception("Celebration LIVE source is unavailable")
                self._json(503, {"detail": "Verified LIVE sales temporarily unavailable"})
                return
            self._json(200, result)
            return
        self._json(404, {"detail": "Not found"})

    def do_POST(self) -> None:
        view = self._view()
        if view not in ("login", "logout"):
            self._json(404, {"detail": "Not found"})
            return
        if not self._login_same_origin():
            self._json(403, {"detail": "Forbidden"})
            return
        try:
            access_password, secret = _access_settings()
        except RuntimeError:
            self._json(503, {"detail": "Celebration access unavailable"})
            return
        if view == "logout":
            self._send(303, b"", "text/plain; charset=utf-8", {
                "Location": "/celebration",
                "Set-Cookie": f"{COOKIE_NAME}=; Path=/celebration; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
            })
            return
        if not _event_open():
            self._json(409, {"detail": "The October 2026 campaign is not active"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            length = -1
        if not (0 < length <= 2048):
            self._json(400, {"detail": "Invalid request"})
            return
        if not self.headers.get("Content-Type", "").lower().startswith("application/x-www-form-urlencoded"):
            self._json(415, {"detail": "Unsupported request"})
            return
        try:
            params = parse_qs(self.rfile.read(length).decode("utf-8"), keep_blank_values=True)
            submitted = params.get("password", [])
            valid = len(submitted) == 1 and hmac.compare_digest(submitted[0], access_password)
        except (UnicodeDecodeError, ValueError):
            valid = False
        if not valid:
            self._login_page(error=True)
            return
        try:
            token, lifetime = _session_token(secret)
        except RuntimeError:
            self._json(409, {"detail": "The October 2026 campaign is not active"})
            return
        self._send(303, b"", "text/plain; charset=utf-8", {
            "Location": "/celebration",
            "Set-Cookie": f"{COOKIE_NAME}={token}; Path=/celebration; Secure; HttpOnly; SameSite=Strict; Max-Age={lifetime}",
        })
