"""Single-use recovery codes. Raw codes are returned once, never persisted."""
import hmac
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from .database import DB_LOCK, connection, one
from .security import digest, hash_password, iso, utcnow, verify_password

INVALID_CODE = "Email or recovery code is incorrect, expired, or already used."


def bootstrap_owner_recovery():
    code_hash = os.getenv("OWNER_RECOVERY_CODE_HASH", "").strip()
    expiry = os.getenv("OWNER_RECOVERY_EXPIRES_AT", "").strip()
    if not code_hash and not expiry:
        return
    if not re.fullmatch(r"[a-f0-9]{64}", code_hash):
        raise RuntimeError("OWNER_RECOVERY_CODE_HASH must be a SHA-256 hex digest")
    try:
        date = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if date.tzinfo is None:
            raise ValueError("Timezone required")
        expiry = iso(date.astimezone(timezone.utc))
    except ValueError as exc:
        raise RuntimeError("OWNER_RECOVERY_EXPIRES_AT must include a timezone") from exc
    if expiry <= iso():
        return
    # The ledger prevents a restart from restoring an already consumed code.
    with DB_LOCK, connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        owner = conn.execute("SELECT id FROM users WHERE email=?", (os.getenv("OWNER_EMAIL", "").strip().lower(),)).fetchone()
        if not owner:
            return
        inserted = conn.execute("INSERT INTO recovery_bootstraps(code_hash,applied_at) VALUES(?,?) ON CONFLICT DO NOTHING RETURNING code_hash", (code_hash, iso())).fetchone()
        if inserted:
            conn.execute("""INSERT INTO recovery_credentials(user_id,code_hash,expires_at,updated_at)
                VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
                code_hash=excluded.code_hash,expires_at=excluded.expires_at,updated_at=excluded.updated_at""", (owner[0], code_hash, expiry, iso()))


def check_recovery_rate(email: str):
    now = int(time.time())
    limited = False
    # Stored in Turso so restarting a free instance cannot reset the limit.
    with DB_LOCK, connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM recovery_attempts WHERE window_start <= ?", (now - 900,))
        for identity, limit in (("global", 60), (email.lower(), 5)):
            row = conn.execute("""INSERT INTO recovery_attempts(identity_hash,attempts,window_start)
                VALUES(?,1,?) ON CONFLICT(identity_hash) DO UPDATE SET attempts=attempts+1
                RETURNING attempts""", (digest("recovery:" + identity), now)).fetchone()
            if row[0] > limit:
                limited = True
                break
    if limited:
        raise HTTPException(429, "Too many recovery attempts. Try again in 15 minutes.", headers={"Retry-After": "900"})


def fresh_code():
    return secrets.token_urlsafe(32), iso(utcnow() + timedelta(days=365))


def recover_account(email: str, code: str, password: str):
    check_recovery_rate(email)
    row = one("""SELECT r.user_id,r.code_hash,r.expires_at FROM recovery_credentials r
        JOIN users u ON u.id=r.user_id WHERE u.email=?""", (email.lower(),))
    candidate = digest(code.strip())
    if not hmac.compare_digest(candidate, row["code_hash"] if row else "0" * 64) or not row or row["expires_at"] <= iso():
        raise HTTPException(400, INVALID_CODE)
    password_hash = hash_password(password)
    replacement, expiry = fresh_code()
    with DB_LOCK, connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        consumed = conn.execute("""UPDATE recovery_credentials SET code_hash=?,expires_at=?,updated_at=?
            WHERE user_id=? AND code_hash=? AND expires_at>? RETURNING user_id""",
            (digest(replacement), expiry, iso(), row["user_id"], candidate, iso())).fetchone()
        if not consumed:
            raise HTTPException(400, INVALID_CODE)
        conn.execute("UPDATE users SET password_hash=?,updated_at=? WHERE id=?", (password_hash, iso(), row["user_id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
    return {"recoveryCode": replacement, "expiresAt": expiry}


def replace_recovery_code(user_id: str, email: str, password: str):
    check_recovery_rate(email)
    row = one("SELECT password_hash FROM users WHERE id=?", (user_id,))
    if not verify_password(password, row["password_hash"] if row else None):
        raise HTTPException(400, "Incorrect password")
    raw, expiry = fresh_code()
    with DB_LOCK, connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
        if not current or current[0] != row["password_hash"]:
            raise HTTPException(409, "Your password changed. Sign in again.")
        conn.execute("""INSERT INTO recovery_credentials(user_id,code_hash,expires_at,updated_at)
            VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
            code_hash=excluded.code_hash,expires_at=excluded.expires_at,updated_at=excluded.updated_at""", (user_id, digest(raw), expiry, iso()))
    return {"recoveryCode": raw, "expiresAt": expiry}
