from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from pwdlib import PasswordHash

from .database import execute, one

password_hash = PasswordHash.recommended()
# Precomputed non-secret dummy hash; unknown accounts still perform Argon2 verification.
DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$oRg+z33Wt4rR6G4c9XAz/g$cjxEZOIbf5Cpmr4fn6srsahg3p4r+m7+6PWlCrrIIa0'
SESSION_COOKIE = "ml_session"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or utcnow()).isoformat(timespec="seconds")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        password_hash.verify(password, DUMMY_HASH)
        return False
    return password_hash.verify(password, stored_hash)


@dataclass(frozen=True)
class SessionUser:
    id: str
    email: str
    display_name: str
    session_hash: str
    csrf_token: str


def session_csrf(raw_token: str) -> str:
    # Stable for the session, so opening another tab cannot invalidate a form.
    return hmac.new(raw_token.encode(), b"model-lab-csrf-v1", hashlib.sha256).hexdigest()


def create_session(user_id: str, response: Response) -> str:
    raw_token = secrets.token_urlsafe(40)
    raw_csrf = session_csrf(raw_token)
    days = max(1, min(int(os.getenv("SESSION_DAYS", "30")), 90))
    expires = utcnow() + timedelta(days=days)
    execute(
        "INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)",
        (digest(raw_token), user_id, digest(raw_csrf), iso(expires), iso()),
    )
    secure = os.getenv("COOKIE_SECURE", "true").lower() not in {"0", "false", "no"}
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        max_age=days * 86400,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    return raw_csrf


def clear_session(response: Response, raw_token: str | None) -> None:
    if raw_token:
        execute("DELETE FROM sessions WHERE token_hash = ?", (digest(raw_token),))
    response.delete_cookie(SESSION_COOKIE, path="/")


def current_user(session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None) -> SessionUser:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token_hash = digest(session_token)
    row = one(
        """SELECT u.id,u.email,u.display_name,s.token_hash,s.expires_at
           FROM sessions s JOIN users u ON u.id=s.user_id
           WHERE s.token_hash=?""",
        (token_hash,),
    )
    if not row or row["expires_at"] <= iso():
        if row:
            execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return SessionUser(row["id"], row["email"], row["display_name"], token_hash, session_csrf(session_token))


def require_csrf(
    user: Annotated[SessionUser, Depends(current_user)],
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> SessionUser:
    row = one("SELECT csrf_hash FROM sessions WHERE token_hash=?", (user.session_hash,))
    expected = row.get("csrf_hash") if row else None
    if not csrf_token or not expected or not hmac.compare_digest(digest(csrf_token), expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    return user


def rotate_csrf(user: SessionUser) -> str:
    raw_csrf = user.csrf_token
    execute("UPDATE sessions SET csrf_hash=? WHERE token_hash=?", (digest(raw_csrf), user.session_hash))
    return raw_csrf


CurrentUser = Annotated[SessionUser, Depends(current_user)]
MutatingUser = Annotated[SessionUser, Depends(require_csrf)]
