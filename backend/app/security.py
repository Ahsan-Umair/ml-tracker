from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, Response
from pwdlib import PasswordHash

from .database import execute, one

password_hash = PasswordHash.recommended()
DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$oRg+z33Wt4rR6G4c9XAz/g$cjxEZOIbf5Cpmr4fn6srsahg3p4r+m7+6PWlCrrIIa0'
SESSION_COOKIE = 'ml_session'


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or utcnow()).isoformat(timespec='seconds')


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
    token_id: str | None = None
    project_id: str | None = None


def session_csrf(raw_token: str) -> str:
    return hmac.new(raw_token.encode(), b'model-lab-csrf-v1', hashlib.sha256).hexdigest()


def create_session(user_id: str, response: Response, conn=None) -> str:
    raw_token = secrets.token_urlsafe(40)
    raw_csrf = session_csrf(raw_token)
    days = max(1, min(int(os.getenv('SESSION_DAYS', '30')), 90))
    statement = 'INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at,id) VALUES(?,?,?,?,?,?)'
    values = (digest(raw_token), user_id, digest(raw_csrf), iso(utcnow() + timedelta(days=days)), iso(), 'ses_' + uuid.uuid4().hex)
    if conn is not None:
        conn.execute(statement, values)
    else:
        execute(statement, values)
    response.set_cookie(SESSION_COOKIE, raw_token, max_age=days * 86400, httponly=True,
                        secure=os.getenv('COOKIE_SECURE', 'true').lower() not in {'0', 'false', 'no'}, samesite='lax', path='/')
    return raw_csrf


def clear_session(response: Response, raw_token: str | None) -> None:
    if raw_token:
        execute('DELETE FROM sessions WHERE token_hash=?', (digest(raw_token),))
    response.delete_cookie(SESSION_COOKIE, path='/')


def current_user(request: Request, session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
                 authorization: Annotated[str | None, Header()] = None) -> SessionUser:
    if authorization:
        scheme, _, token = authorization.partition(' ')
        if scheme.lower() != 'bearer' or not token.startswith('ml_'):
            raise HTTPException(401, 'Invalid API token')
        row = one('''SELECT u.id,u.email,u.display_name,t.id AS api_token_id,t.scopes,t.project_id,t.expires_at
                     FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?''', (digest(token),))
        if not row or row['expires_at'] <= iso():
            raise HTTPException(401, 'Invalid or expired API token')
        path = request.url.path
        if path.startswith('/api/auth/') or path.startswith('/api/workspace/'):
            raise HTTPException(403, 'Use an interactive session for account management and data transfer')
        scopes = json.loads(row['scopes'])
        read = request.method in {'GET', 'HEAD', 'OPTIONS'}
        metrics_write = request.method == 'POST' and (path.endswith('/metrics') or path.endswith('/metrics/batch'))
        if not ('write' in scopes or (read and 'read' in scopes) or (metrics_write and 'metrics:write' in scopes)):
            raise HTTPException(403, 'API token does not permit this action')
        # Last-use writes are bounded to once a minute, rather than one per metric.
        execute('UPDATE api_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)',
                (iso(), row['api_token_id'], iso(utcnow() - timedelta(minutes=1))))
        return SessionUser(row['id'], row['email'], row['display_name'], '', '', row['api_token_id'], row['project_id'])
    if not session_token:
        raise HTTPException(401, 'Not authenticated')
    token_hash = digest(session_token)
    row = one('''SELECT u.id,u.email,u.display_name,s.token_hash,s.expires_at
                 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?''', (token_hash,))
    if not row or row['expires_at'] <= iso():
        if row:
            execute('DELETE FROM sessions WHERE token_hash=?', (token_hash,))
        raise HTTPException(401, 'Session expired')
    return SessionUser(row['id'], row['email'], row['display_name'], token_hash, session_csrf(session_token))


def require_csrf(user: Annotated[SessionUser, Depends(current_user)],
                 csrf_token: Annotated[str | None, Header(alias='X-CSRF-Token')] = None) -> SessionUser:
    if user.token_id:
        return user
    row = one('SELECT csrf_hash FROM sessions WHERE token_hash=?', (user.session_hash,))
    expected = row.get('csrf_hash') if row else None
    if not csrf_token or not expected or not hmac.compare_digest(digest(csrf_token), expected):
        raise HTTPException(403, 'Invalid CSRF token')
    return user


def rotate_csrf(user: SessionUser) -> str:
    execute('UPDATE sessions SET csrf_hash=? WHERE token_hash=?', (digest(user.csrf_token), user.session_hash))
    return user.csrf_token


CurrentUser = Annotated[SessionUser, Depends(current_user)]
MutatingUser = Annotated[SessionUser, Depends(require_csrf)]
