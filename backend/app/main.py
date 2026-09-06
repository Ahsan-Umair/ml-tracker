from __future__ import annotations

import json
import hmac
import os
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import timedelta
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .database import execute, initialize_database, one, query
from .recovery import bootstrap_owner_recovery, recover_account, replace_recovery_code
from .schemas import (
    DatasetInput,
    ExperimentInput,
    ExperimentStatusInput,
    LoginInput,
    RecoveryInput,
    RecoveryCodeInput,
    MetricInput,
    ModelInput,
    ModelVersionInput,
    ProjectInput,
    RegisterInput,
    RunInput,
    RunStatusInput,
)
from .security import (
    CurrentUser,
    MutatingUser,
    SESSION_COOKIE,
    clear_session,
    create_session,
    hash_password,
    iso,
    rotate_csrf,
    utcnow,
    verify_password,
)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def public_user(user: Any) -> dict[str, str]:
    return {"id": user.id, "email": user.email, "displayName": user.display_name}


def require_owned(table: str, record_id: str, user_id: str) -> dict[str, Any]:
    if table not in {"projects", "datasets", "models", "model_versions", "experiments", "runs"}:
        raise ValueError("Unsupported table")
    row = one(f"SELECT * FROM {table} WHERE id=? AND user_id=?", (record_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    return row


def json_field(value: Any) -> dict[str, Any]:
    try:
        return json.loads(value or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("APP_ENV") == "production":
        if os.getenv("COOKIE_SECURE", "true").lower() in {"false", "0", "no"}:
            raise RuntimeError("Production requires secure cookies")
        if not os.getenv("OWNER_EMAIL") or len(os.getenv("REGISTRATION_TOKEN", "")) < 32:
            raise RuntimeError("Production requires OWNER_EMAIL and a strong REGISTRATION_TOKEN")
    initialize_database()
    bootstrap_owner_recovery()
    execute("DELETE FROM sessions WHERE expires_at <= ?", (iso(),))
    yield


app = FastAPI(
    title="Model Lab API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

origins = [item.strip().rstrip("/") for item in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",") if item.strip()]
auth_attempts: dict[str, deque[float]] = defaultdict(deque)
auth_attempts_lock = Lock()


def check_auth_rate(request: Request, identity: str) -> str:
    client_ip = request.client.host if request.client else "unknown"
    key = f"identity:{identity.lower()}"
    now = time.monotonic()
    with auth_attempts_lock:
        for stale in [k for k, v in auth_attempts.items() if not v or now - v[-1] > 900]:
            auth_attempts.pop(stale, None)
        for bucket, limit in ((key, 10), (f"ip:{client_ip}", 100)):
            if bucket not in auth_attempts and len(auth_attempts) >= 4096:
                raise HTTPException(status_code=429, detail="Please try again later")
            attempts = auth_attempts[bucket]
            while attempts and now - attempts[0] > 900:
                attempts.popleft()
            if len(attempts) >= limit:
                raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.", headers={"Retry-After": "900"})
            attempts.append(now)
    return key


def clear_auth_rate(key: str) -> None:
    with auth_attempts_lock:
        auth_attempts.pop(key, None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def browser_origin_guard(request: Request, call_next):
    if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in origins:
            return JSONResponse(status_code=403, content={"detail": "Origin is not allowed"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/api/health")
def health() -> dict[str, str]:
    one("SELECT 1 AS ok")
    return {"status": "healthy"}


# Authentication
@app.post("/api/auth/recover")
def recover(payload: RecoveryInput, response: Response):
    result = recover_account(str(payload.email), payload.recovery_code, payload.password)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return result


@app.post("/api/auth/recovery-code")
def recovery_code(payload: RecoveryCodeInput, user: MutatingUser):
    return replace_recovery_code(user.id, user.email, payload.password)


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterInput, response: Response, request: Request):
    if os.getenv("ALLOW_REGISTRATION", "true").lower() in {"0", "false", "no"}:
        raise HTTPException(status_code=403, detail="New account registration is disabled")
    rate_key = check_auth_rate(request, "register")
    email = str(payload.email).lower()
    owner = os.getenv("OWNER_EMAIL", "").strip().lower()
    setup_token = os.getenv("REGISTRATION_TOKEN", "")
    if owner and email != owner:
        raise HTTPException(status_code=403, detail="Registration is restricted to the workspace owner")
    if setup_token and not hmac.compare_digest(payload.registration_token.encode(), setup_token.encode()):
        raise HTTPException(status_code=403, detail="A valid private setup code is required")
    if one("SELECT id FROM users WHERE email=?", (email,)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user_id, now = new_id("usr"), iso()
    execute(
        "INSERT INTO users(id,email,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        (user_id, email, payload.display_name, hash_password(payload.password), now, now),
    )
    csrf = create_session(user_id, response)
    clear_auth_rate(rate_key)
    return {"user": {"id": user_id, "email": email, "displayName": payload.display_name}, "csrfToken": csrf}


@app.post("/api/auth/login")
def login(payload: LoginInput, response: Response, request: Request):
    rate_key = check_auth_rate(request, str(payload.email))
    row = one("SELECT id,email,display_name,password_hash FROM users WHERE email=?", (str(payload.email).lower(),))
    if not verify_password(payload.password, row.get("password_hash") if row else None):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    csrf = create_session(row["id"], response)
    clear_auth_rate(rate_key)
    return {"user": {"id": row["id"], "email": row["email"], "displayName": row["display_name"]}, "csrfToken": csrf}


@app.get("/api/auth/me")
def me(user: CurrentUser):
    return {"user": public_user(user)}


@app.get("/api/auth/csrf")
def csrf(user: CurrentUser):
    return {"csrfToken": rotate_csrf(user)}


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, _: MutatingUser):
    clear_session(response, request.cookies.get(SESSION_COOKIE))


# Dashboard and analysis
@app.get("/api/dashboard")
def dashboard(user: CurrentUser):
    stats = one(
        """SELECT
          (SELECT COUNT(*) FROM projects WHERE user_id=?) AS projects,
          (SELECT COUNT(*) FROM model_versions WHERE user_id=?) AS model_versions,
          (SELECT COUNT(*) FROM runs WHERE user_id=?) AS runs,
          (SELECT MAX(value) FROM metrics WHERE user_id=? AND name IN ('accuracy','val_accuracy','validation_accuracy','test_accuracy','val_acc','test_acc')) AS best_accuracy""",
        (user.id, user.id, user.id, user.id),
    )
    recent_runs = query(
        """SELECT r.id,r.name,r.status,r.started_at,r.ended_at,e.name AS experiment,
          (SELECT MAX(m.value) FROM metrics m WHERE m.run_id=r.id AND m.name IN ('accuracy','val_accuracy','validation_accuracy','test_accuracy','val_acc','test_acc')) AS score
          FROM runs r JOIN experiments e ON e.id=r.experiment_id
          WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 5""",
        (user.id,),
    )
    trend = query(
        """SELECT substr(logged_at,1,10) AS day, MAX(value) AS value
          FROM metrics WHERE user_id=? AND name IN ('accuracy','val_accuracy','validation_accuracy','test_accuracy','val_acc','test_acc')
          GROUP BY substr(logged_at,1,10) ORDER BY day DESC LIMIT 14""",
        (user.id,),
    )
    top_models = query(
        """SELECT mo.id,mo.name,mo.framework,mo.status,p.name AS project,
          MAX(me.value) AS score, COUNT(DISTINCT mv.id) AS versions
          FROM models mo JOIN projects p ON p.id=mo.project_id
          LEFT JOIN model_versions mv ON mv.model_id=mo.id
          LEFT JOIN runs r ON r.model_version_id=mv.id
          LEFT JOIN metrics me ON me.run_id=r.id AND me.name IN ('accuracy','val_accuracy','validation_accuracy','test_accuracy','val_acc','test_acc')
          WHERE mo.user_id=? GROUP BY mo.id,mo.name,mo.framework,mo.status,p.name
          ORDER BY score DESC, mo.updated_at DESC LIMIT 6""",
        (user.id,),
    )
    return {"stats": stats, "recentRuns": recent_runs, "trend": list(reversed(trend)), "topModels": top_models}


@app.get("/api/leaderboard")
def leaderboard(user: CurrentUser):
    return query(
        """SELECT r.id,r.name AS run,e.name AS experiment,mo.name AS model,mv.version,
          MAX(me.value) AS score,r.ended_at,
          RANK() OVER (PARTITION BY e.id ORDER BY MAX(me.value) DESC) AS rank
          FROM runs r JOIN experiments e ON e.id=r.experiment_id
          LEFT JOIN model_versions mv ON mv.id=r.model_version_id
          LEFT JOIN models mo ON mo.id=mv.model_id
          JOIN metrics me ON me.run_id=r.id AND me.name IN ('accuracy','val_accuracy','validation_accuracy','test_accuracy','val_acc','test_acc')
          WHERE r.user_id=? AND r.status='completed' GROUP BY r.id,r.name,e.id,e.name,mo.name,mv.version,r.ended_at
          ORDER BY score DESC""",
        (user.id,),
    )


@app.get("/api/analytics")
def analytics(user: CurrentUser):
    statuses = query("SELECT status,COUNT(*) AS count FROM runs WHERE user_id=? GROUP BY status", (user.id,))
    frameworks = query("SELECT framework,COUNT(*) AS count FROM models WHERE user_id=? GROUP BY framework ORDER BY count DESC", (user.id,))
    storage = query(
        """SELECT p.name AS project,COUNT(d.id) AS datasets,COALESCE(SUM(d.size_bytes),0) AS bytes
           FROM projects p LEFT JOIN datasets d ON d.project_id=p.id WHERE p.user_id=? GROUP BY p.id,p.name ORDER BY bytes DESC""",
        (user.id,),
    )
    metric_names = query("SELECT name,COUNT(*) AS readings FROM metrics WHERE user_id=? GROUP BY name ORDER BY readings DESC LIMIT 12", (user.id,))
    return {"runStatuses": statuses, "frameworks": frameworks, "storage": storage, "metricNames": metric_names}


# Projects
@app.get("/api/projects")
def list_projects(user: CurrentUser):
    return query(
        """SELECT p.*,
          (SELECT COUNT(*) FROM experiments e WHERE e.project_id=p.id) AS experiments,
          (SELECT COUNT(*) FROM datasets d WHERE d.project_id=p.id) AS datasets,
          (SELECT COUNT(*) FROM models m WHERE m.project_id=p.id) AS models
          FROM projects p WHERE p.user_id=? ORDER BY p.updated_at DESC""",
        (user.id,),
    )


@app.post("/api/projects", status_code=201)
def create_project(payload: ProjectInput, user: MutatingUser):
    record_id, now = new_id("prj"), iso()
    execute("INSERT INTO projects(id,user_id,name,description,color,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (record_id,user.id,payload.name,payload.description,payload.color,now,now))
    return one("SELECT * FROM projects WHERE id=?", (record_id,))


@app.patch("/api/projects/{record_id}")
def update_project(record_id: str, payload: ProjectInput, user: MutatingUser):
    require_owned("projects", record_id, user.id)
    execute("UPDATE projects SET name=?,description=?,color=?,updated_at=? WHERE id=?", (payload.name,payload.description,payload.color,iso(),record_id))
    return one("SELECT * FROM projects WHERE id=?", (record_id,))


@app.delete("/api/projects/{record_id}", status_code=204)
def delete_project(record_id: str, user: MutatingUser):
    require_owned("projects", record_id, user.id)
    execute("DELETE FROM projects WHERE id=?", (record_id,))


# Datasets
@app.get("/api/datasets")
def list_datasets(user: CurrentUser, project_id: str | None = None):
    sql = """SELECT d.*,p.name AS project_name FROM datasets d JOIN projects p ON p.id=d.project_id WHERE d.user_id=?"""
    params: list[Any] = [user.id]
    if project_id:
        sql += " AND d.project_id=?"
        params.append(project_id)
    return query(sql + " ORDER BY d.updated_at DESC", params)


@app.post("/api/datasets", status_code=201)
def create_dataset(payload: DatasetInput, user: MutatingUser):
    require_owned("projects", payload.project_id, user.id)
    record_id, now = new_id("dat"), iso()
    execute(
        "INSERT INTO datasets(id,project_id,user_id,name,version,format,uri,size_bytes,row_count,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (record_id,payload.project_id,user.id,payload.name,payload.version,payload.format,payload.uri,payload.size_bytes,payload.row_count,payload.description,now,now),
    )
    return one("SELECT * FROM datasets WHERE id=?", (record_id,))


@app.delete("/api/datasets/{record_id}", status_code=204)
def delete_dataset(record_id: str, user: MutatingUser):
    require_owned("datasets", record_id, user.id)
    execute("DELETE FROM datasets WHERE id=?", (record_id,))


# Models and versions
@app.get("/api/models")
def list_models(user: CurrentUser, project_id: str | None = None):
    sql = """SELECT m.*,p.name AS project_name,(SELECT COUNT(*) FROM model_versions v WHERE v.model_id=m.id) AS versions FROM models m JOIN projects p ON p.id=m.project_id WHERE m.user_id=?"""
    params: list[Any] = [user.id]
    if project_id:
        sql += " AND m.project_id=?"
        params.append(project_id)
    return query(sql + " ORDER BY m.updated_at DESC", params)


@app.post("/api/models", status_code=201)
def create_model(payload: ModelInput, user: MutatingUser):
    require_owned("projects", payload.project_id, user.id)
    record_id, now = new_id("mod"), iso()
    execute(
        "INSERT INTO models(id,project_id,user_id,name,framework,task_type,status,repository_url,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (record_id,payload.project_id,user.id,payload.name,payload.framework,payload.task_type,payload.status,payload.repository_url,payload.description,now,now),
    )
    return one("SELECT * FROM models WHERE id=?", (record_id,))


@app.get("/api/models/{record_id}/versions")
def list_model_versions(record_id: str, user: CurrentUser):
    require_owned("models", record_id, user.id)
    return query("SELECT * FROM model_versions WHERE model_id=? AND user_id=? ORDER BY created_at DESC", (record_id,user.id))


@app.get("/api/model-versions")
def list_all_model_versions(user: CurrentUser):
    return query(
        """SELECT v.*,m.name AS model_name,m.project_id FROM model_versions v
           JOIN models m ON m.id=v.model_id WHERE v.user_id=? ORDER BY v.created_at DESC""",
        (user.id,),
    )


@app.post("/api/models/{record_id}/versions", status_code=201)
def create_model_version(record_id: str, payload: ModelVersionInput, user: MutatingUser):
    require_owned("models", record_id, user.id)
    if one("SELECT id FROM model_versions WHERE model_id=? AND version=?", (record_id,payload.version)):
        raise HTTPException(status_code=409, detail="This model version already exists")
    version_id = new_id("ver")
    execute(
        "INSERT INTO model_versions(id,model_id,user_id,version,stage,artifact_uri,parameters_count,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (version_id,record_id,user.id,payload.version,payload.stage,payload.artifact_uri,payload.parameters_count,payload.notes,iso()),
    )
    execute("UPDATE models SET updated_at=? WHERE id=?", (iso(),record_id))
    return one("SELECT * FROM model_versions WHERE id=?", (version_id,))


@app.delete("/api/models/{record_id}", status_code=204)
def delete_model(record_id: str, user: MutatingUser):
    require_owned("models", record_id, user.id)
    execute("DELETE FROM models WHERE id=?", (record_id,))


# Experiments
@app.get("/api/experiments")
def list_experiments(user: CurrentUser, project_id: str | None = None):
    sql = """SELECT e.*,p.name AS project_name,d.name AS dataset_name,m.name AS model_name,
      (SELECT COUNT(*) FROM runs r WHERE r.experiment_id=e.id) AS runs
      FROM experiments e JOIN projects p ON p.id=e.project_id
      LEFT JOIN datasets d ON d.id=e.dataset_id LEFT JOIN models m ON m.id=e.model_id WHERE e.user_id=?"""
    params: list[Any] = [user.id]
    if project_id:
        sql += " AND e.project_id=?"
        params.append(project_id)
    return query(sql + " ORDER BY e.updated_at DESC", params)


@app.post("/api/experiments", status_code=201)
def create_experiment(payload: ExperimentInput, user: MutatingUser):
    require_owned("projects", payload.project_id, user.id)
    if payload.dataset_id:
        dataset = require_owned("datasets", payload.dataset_id, user.id)
        if dataset["project_id"] != payload.project_id:
            raise HTTPException(status_code=422, detail="Dataset must belong to the selected project")
    if payload.model_id:
        model = require_owned("models", payload.model_id, user.id)
        if model["project_id"] != payload.project_id:
            raise HTTPException(status_code=422, detail="Model must belong to the selected project")
    record_id, now = new_id("exp"), iso()
    execute(
        "INSERT INTO experiments(id,project_id,dataset_id,model_id,user_id,name,status,objective,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (record_id,payload.project_id,payload.dataset_id,payload.model_id,user.id,payload.name,payload.status,payload.objective,payload.description,now,now),
    )
    return one("SELECT * FROM experiments WHERE id=?", (record_id,))


@app.patch("/api/experiments/{record_id}/status")
def update_experiment_status(record_id: str, payload: ExperimentStatusInput, user: MutatingUser):
    require_owned("experiments", record_id, user.id)
    execute("UPDATE experiments SET status=?,updated_at=? WHERE id=?", (payload.status,iso(),record_id))
    return one("SELECT * FROM experiments WHERE id=?", (record_id,))


@app.delete("/api/experiments/{record_id}", status_code=204)
def delete_experiment(record_id: str, user: MutatingUser):
    require_owned("experiments", record_id, user.id)
    execute("DELETE FROM experiments WHERE id=?", (record_id,))


# Runs and metrics
@app.get("/api/runs")
def list_runs(user: CurrentUser, experiment_id: str | None = None):
    sql = """SELECT r.*,e.name AS experiment_name,p.name AS project_name,m.name AS model_name,mv.version AS model_version,
      (SELECT MAX(me.value) FROM metrics me WHERE me.run_id=r.id AND me.name IN ('accuracy','val_accuracy','validation_accuracy','test_accuracy','val_acc','test_acc')) AS best_accuracy,
      (SELECT COUNT(*) FROM metrics me WHERE me.run_id=r.id) AS metric_count
      FROM runs r JOIN experiments e ON e.id=r.experiment_id JOIN projects p ON p.id=e.project_id
      LEFT JOIN model_versions mv ON mv.id=r.model_version_id LEFT JOIN models m ON m.id=mv.model_id WHERE r.user_id=?"""
    params: list[Any] = [user.id]
    if experiment_id:
        sql += " AND r.experiment_id=?"
        params.append(experiment_id)
    rows = query(sql + " ORDER BY r.created_at DESC", params)
    for row in rows:
        row["hyperparameters"] = json_field(row.get("hyperparameters"))
        row["environment"] = json_field(row.get("environment"))
    return rows


@app.post("/api/runs", status_code=201)
def create_run(payload: RunInput, user: MutatingUser):
    experiment = require_owned("experiments", payload.experiment_id, user.id)
    if payload.model_version_id:
        version = require_owned("model_versions", payload.model_version_id, user.id)
        model = require_owned("models", version["model_id"], user.id)
        if model["project_id"] != experiment["project_id"] or (experiment["model_id"] and model["id"] != experiment["model_id"]):
            raise HTTPException(status_code=422, detail="Model version must match the experiment's project and model")
    record_id, now = new_id("run"), iso()
    ended_at = now if payload.status in {"completed", "failed", "cancelled"} else None
    execute(
        "INSERT INTO runs(id,experiment_id,model_version_id,user_id,name,run_type,status,hyperparameters,environment,notes,started_at,ended_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (record_id,payload.experiment_id,payload.model_version_id,user.id,payload.name,payload.run_type,payload.status,json.dumps(payload.hyperparameters,separators=(",",":")),json.dumps(payload.environment,separators=(",",":")),payload.notes,now,ended_at,now),
    )
    execute("UPDATE experiments SET status='running',updated_at=? WHERE id=? AND status='draft'", (now,payload.experiment_id))
    return one("SELECT * FROM runs WHERE id=?", (record_id,))


@app.patch("/api/runs/{record_id}/status")
def update_run_status(record_id: str, payload: RunStatusInput, user: MutatingUser):
    row = require_owned("runs", record_id, user.id)
    ended = iso() if payload.status in {"completed", "failed", "cancelled"} else None
    execute("UPDATE runs SET status=?,ended_at=? WHERE id=?", (payload.status,ended,record_id))
    if payload.status == "completed":
        execute("UPDATE experiments SET status='completed',updated_at=? WHERE id=?", (iso(),row["experiment_id"]))
    return one("SELECT * FROM runs WHERE id=?", (record_id,))


@app.get("/api/runs/{record_id}/metrics")
def list_metrics(record_id: str, user: CurrentUser, name: str | None = Query(default=None, max_length=80)):
    require_owned("runs", record_id, user.id)
    if name:
        return query("SELECT * FROM metrics WHERE run_id=? AND user_id=? AND name=? ORDER BY COALESCE(step,2147483647),logged_at", (record_id,user.id,name))
    return query("SELECT * FROM metrics WHERE run_id=? AND user_id=? ORDER BY name,COALESCE(step,2147483647),logged_at", (record_id,user.id))


@app.post("/api/runs/{record_id}/metrics", status_code=201)
def create_metric(record_id: str, payload: MetricInput, user: MutatingUser):
    require_owned("runs", record_id, user.id)
    metric_id = new_id("met")
    execute("INSERT INTO metrics(id,run_id,user_id,name,value,step,logged_at) VALUES(?,?,?,?,?,?,?)", (metric_id,record_id,user.id,payload.name,payload.value,payload.step,iso()))
    return one("SELECT * FROM metrics WHERE id=?", (metric_id,))


@app.delete("/api/runs/{record_id}", status_code=204)
def delete_run(record_id: str, user: MutatingUser):
    require_owned("runs", record_id, user.id)
    execute("DELETE FROM runs WHERE id=?", (record_id,))
