"""Generate an emergency owner recovery code locally; never run in build logs."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

if __name__ == "__main__":
    code = secrets.token_urlsafe(32)
    print(json.dumps({
        "recoveryCode": code,
        "OWNER_RECOVERY_CODE_HASH": hashlib.sha256(code.encode()).hexdigest(),
        "OWNER_RECOVERY_EXPIRES_AT": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(timespec="seconds"),
    }, indent=2))
