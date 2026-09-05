"""JWT authentication for FastAPI — standalone Python implementation."""
import os, time, hmac, hashlib, base64, json, logging
from functools import wraps
from typing import Optional
from fastapi import HTTPException, Request

logger = logging.getLogger("polaris.hq.auth")

ROLE_HIERARCHY = {"NCPOR_ADMIN": 5, "HQ_LOGISTICS": 4, "DISPATCH": 3, "STATION_LEAD": 3, "FIELD_OP": 2, "VIEWER": 1}


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    s += "=" * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)


def _secret_bytes(secret: str) -> bytes:
    # secret is 64 hex chars (32B) — decode hex; fallback to utf8 for backwards compat
    try:
        if len(secret) == 64 and all(c in "0123456789abcdefABCDEF" for c in secret):
            return bytes.fromhex(secret)
    except Exception:
        pass
    return secret.encode()


def sign_jwt(payload: dict, secret: str, expires_in_days: int = 30) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    full_payload = {**payload, "iat": now, "exp": now + expires_in_days * 86400}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(full_payload, separators=(",", ":")).encode())
    data = f"{header_b64}.{payload_b64}"
    sig = hmac.new(_secret_bytes(secret), data.encode(), hashlib.sha256).digest()
    return f"{data}.{_b64url_encode(sig)}"


def verify_jwt(token: str, secret: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        data = f"{parts[0]}.{parts[1]}"
        sig = _b64url_decode(parts[2])
        expected = hmac.new(_secret_bytes(secret), data.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_b64url_decode(parts[1]))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def has_role(user_role: str, required_role: str) -> bool:
    return ROLE_HIERARCHY.get(user_role, 0) >= ROLE_HIERARCHY.get(required_role, 0)


async def get_current_user(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    # BUGFIX: use same fallback as config.SECRET_KEY (SECRET_KEY or PSK_HEX) — was SECRET_KEY only → JWT verify mismatch when PSK_HEX is used as secret
    secret = os.getenv("SECRET_KEY") or os.getenv("PSK_HEX") or "a" * 64
    return verify_jwt(token, secret)


async def require_auth(request: Request) -> dict:
    user = await get_current_user(request)
    if not user:
        raise HTTPException(401, "missing or invalid authorization token")
    return user


def require_role(min_role: str):
    async def _dep(request: Request) -> dict:
        user = await require_auth(request)
        if not has_role(user.get("role", "VIEWER"), min_role):
            raise HTTPException(403, f"requires {min_role} or higher")
        return user
    return _dep
