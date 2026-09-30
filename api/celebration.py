"""Celeste Daily private September 30, 2026 milestone display.

Vercel Python BaseHTTPRequestHandler; no third-party dependencies.
Never expose Odoo credentials to HTML, JS, cookies, or API responses.
"""

from __future__ import annotations

import hashlib
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
EVENT_DAY = date(2026, 9, 30)
EVENT_END = datetime(2026, 10, 1, tzinfo=TZ)
TARGET = Decimal("250000000.00")
COOKIE_NAME = "celeste_250m_event"
COOKIE_MAX_AGE = 86400
SOURCE_CACHE_SECONDS = 25  # Best-effort per warm Vercel instance, not shared across instances.
MAX_SOURCE_AGE_SECONDS = 180
_lock = threading.Lock()
_cache = None
_cache_until = 0.0


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
    return now_local().date() == EVENT_DAY


def _session_token(secret: bytes) -> tuple[str, int]:
    # Sessions automatically expire at the Colombo midnight event boundary.
    remaining = int((EVENT_END - now_local()).total_seconds())
    if remaining <= 0 or not _event_open():
        raise RuntimeError("Celebration event is not active.")
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
        if not (time.time() < issued_expiry <= EVENT_END.timestamp() + 1):
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


def _opening_balance() -> Decimal:
    # Confidential yesterday closing balance lives ONLY in Vercel Environment Variables.
    raw = _required_env("CELEBRATION_YESTERDAY_CLOSING")
    opening = _money(raw, "CELEBRATION_YESTERDAY_CLOSING")
    if opening != opening.quantize(Decimal("0.01")):
        raise ValueError("Celebration opening balance must have two decimal places")
    return opening


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


def _read_odoo() -> tuple[Decimal, int, datetime]:
    base = _required_env("ODOO_BASE_URL").rstrip("/")
    if not base.startswith("https://"):
        raise RuntimeError("ODOO_BASE_URL must use HTTPS")
    key = _required_env("ODOO_API_KEY")
    started = now_local()  # Conservative source timestamp: before the upstream read.
    endpoint = base + "/json/2/celeste.management.dashboard/get_dashboard_data_for_client"
    payload = json.dumps({
        "date_from": EVENT_DAY.isoformat(),
        "date_to": EVENT_DAY.isoformat(),
        "sales_team_ids": [],
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=payload, method="POST",
        headers={
            "Authorization": "bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "CelesteDailyCelebration/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise ValueError("Unexpected Odoo HTTP status")
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Odoo response exceeds safe size limit")
    dashboard = json.loads(raw)
    sales, orders = _validated_sales(dashboard)
    return sales, orders, started


def celebration_snapshot() -> dict:
    global _cache, _cache_until
    if not _event_open():
        raise ValueError("The September 30 celebration event has ended")
    opening_balance = _opening_balance()
    # One upstream request at a time *inside each warm instance*.
    with _lock:
        now = now_local()
        if (_cache is not None and time.monotonic() < _cache_until
                and 0 <= (now - _cache["source_time"]).total_seconds() <= MAX_SOURCE_AGE_SECONDS):
            source = _cache
        else:
            today, orders, read_at = _read_odoo()
            if (now_local() - read_at).total_seconds() > MAX_SOURCE_AGE_SECONDS:
                raise ValueError("Odoo source response is stale")
            source = {"today": today, "orders": orders, "source_time": read_at}
            _cache, _cache_until = source, time.monotonic() + SOURCE_CACHE_SECONDS
        current = now_local()
        if current.date() != EVENT_DAY:
            raise ValueError("The September 30 celebration event has ended")
        if (current - source["source_time"]).total_seconds() > MAX_SOURCE_AGE_SECONDS:
            raise ValueError("Odoo source response is stale")
        today = source["today"]
        monthly = opening_balance + today
        remaining = max(Decimal("0.00"), TARGET - monthly)
        above = max(Decimal("0.00"), monthly - TARGET)
        return {
            "event": "CELESTE_250_MILLION",
            "business_date": EVENT_DAY.isoformat(),
            "source": "ODOO_MANAGEMENT_DASHBOARD",
            "status": "LIVE",
            "yesterday_closing": float(opening_balance),
            "today_sales": float(today),
            "monthly_sales": float(monthly),
            "target": float(TARGET),
            "remaining": float(remaining),
            "above_target": float(above),
            "progress_percent": float(monthly / TARGET * Decimal("100")),
            "target_achieved": monthly >= TARGET,
            "order_count": source["orders"],
            "live_read_at": source["source_time"].isoformat(),
            "server_time": current.isoformat(),
            "deadline": EVENT_END.isoformat(),
        }


_LOGIN_HTML = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="theme-color" content="#090909">
<title>Celeste Daily | Celebration Access</title>
<link rel="stylesheet" href="/celebration/celebration.css"></head>
<body><main class="login-shell"><section class="login-card">
<div class="login-brand">✦ CELESTE <span>DAILY</span></div>
<div class="login-eyebrow">PRIVATE MILESTONE DISPLAY · 30 SEPTEMBER</div>
<h1>THE ROAD TO<br>250 MILLION.</h1>
<p>Enter your celebration access password to follow our live September milestone.</p>
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
        if len(selection) == 1 and selection[0] in {"page", "css", "js", "data", "login", "logout"}:
            return selection[0]
        # Local smoke tests / local direct invocation of this function.
        return {
            "/celebration": "page", "/celebration/": "page",
            "/celebration/celebration.css": "css", "/celebration/celebration.js": "js",
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
        if view in ("css", "js"):
            name = "celebration.css" if view == "css" else "celebration.js"
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
                self._send(409, b"This September 30 live event has ended.", "text/plain; charset=utf-8")
                return
            if not self._authenticated():
                self._login_page()
                return
            try:
                data = (ASSETS / "celebration.html").read_bytes()
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
                self._json(409, {"detail": "The September 30 live event has ended"})
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
            self._json(409, {"detail": "The September 30 live event has ended"})
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
            self._json(409, {"detail": "The September 30 live event has ended"})
            return
        self._send(303, b"", "text/plain; charset=utf-8", {
            "Location": "/celebration",
            "Set-Cookie": f"{COOKIE_NAME}={token}; Path=/celebration; Secure; HttpOnly; SameSite=Strict; Max-Age={lifetime}",
        })
