from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from .database import DB_LOCK, connection, execute, initialize_database, one, query, read_connection
from .recovery import bootstrap_owner_recovery, recover_account, replace_recovery_code
from .schemas import (
    DatasetInput, DatasetPatch, ExperimentInput, ExperimentPatch, ExperimentStatusInput,
    ImportInput, LoginInput, MetricBatchInput, MetricInput, ModelInput, ModelPatch,
    ModelVersionInput, ModelVersionPatch, PasswordInput, ProfileInput, ProjectInput,
    ProjectPatch, RecoveryCodeInput, RecoveryInput, RegisterInput, RunInput, RunPatch,
    RunStatusInput, TokenInput,
)
from .security import (
    CurrentUser, MutatingUser, SESSION_COOKIE, SessionUser, clear_session, create_session,
    digest, hash_password, iso, rotate_csrf, utcnow, verify_password,
)

logger = logging.getLogger('model_lab.requests')
if not logger.handlers:
    request_handler = logging.StreamHandler()
    request_handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(request_handler)
logger.setLevel(logging.INFO)
logger.propagate = False
# Compatibility import for older callers; rate limits themselves are durable.
auth_attempts: dict[str, Any] = {}
TABLES = ('projects', 'datasets', 'models', 'model_versions', 'experiments', 'runs', 'metrics')
PREFIXES = dict(zip(TABLES, ('prj', 'dat', 'mod', 'ver', 'exp', 'run', 'met')))
POLICY_FIELDS = ('primary_metric', 'metric_direction', 'metric_aggregation', 'metric_unit', 'metric_split', 'metric_policy_confirmed')
JSON_FIELDS = ('tags', 'hyperparameters', 'environment', 'provenance')
INPUTS = {'projects': ProjectInput, 'datasets': DatasetInput, 'models': ModelInput,
          'model_versions': ModelVersionInput, 'experiments': ExperimentInput, 'runs': RunInput, 'metrics': MetricInput}
TERMINAL = {'completed', 'failed', 'cancelled'}


def new_id(prefix: str) -> str:
    return f'{prefix}_{uuid.uuid4().hex}'


def public_user(user: Any) -> dict[str, str]:
    return {'id': user.id, 'email': user.email, 'displayName': user.display_name}


def decode(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    for name in JSON_FIELDS:
        if name in result and isinstance(result[name], str):
            try:
                result[name] = json.loads(result[name])
            except (TypeError, ValueError):
                result[name] = [] if name == 'tags' else {}
    if 'archived_at' in result:
        result['archived'] = bool(result['archived_at'])
    if 'started_at' in result:
        result['started_at'] = result['started_at'] or None
    if 'metric_policy_confirmed' in result:
        result['metric_policy_confirmed'] = bool(result['metric_policy_confirmed'])
    return result


def project_of(table: str, row: dict[str, Any]) -> str:
    if table == 'projects':
        return row['id']
    if table in {'datasets', 'models', 'experiments'}:
        return row['project_id']
    if table == 'model_versions':
        parent = one('SELECT project_id FROM models WHERE id=?', (row['model_id'],))
    elif table == 'runs':
        parent = one('SELECT project_id FROM experiments WHERE id=?', (row['experiment_id'],))
    else:
        parent = one('SELECT e.project_id FROM runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.id=?', (row['run_id'],))
    return parent['project_id'] if parent else ''


def require_owned(table: str, record_id: str, user: SessionUser) -> dict[str, Any]:
    if table not in TABLES:
        raise ValueError('Unsupported table')
    row = one(f'SELECT * FROM {table} WHERE id=? AND user_id=?', (record_id, user.id))
    if not row or (user.project_id and project_of(table, row) != user.project_id):
        raise HTTPException(404, 'Record not found')
    return decode(row)


def check_auth_rate(request: Request, identity: str) -> str:
    now = int(time.time())
    key = digest('auth:identity:' + identity.lower())
    ip = request.client.host if request.client else 'unknown'
    limited = False
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('DELETE FROM auth_rate_limits WHERE window_start<=?', (now - 900,))
        for bucket, limit in ((key, 10), (digest('auth:ip:' + ip), 100)):
            row = conn.execute('''INSERT INTO auth_rate_limits(identity_hash,attempts,window_start) VALUES(?,1,?)
                ON CONFLICT(identity_hash) DO UPDATE SET attempts=attempts+1 RETURNING attempts''', (bucket, now)).fetchone()
            if row[0] > limit:
                limited = True
                break
    if limited:
        raise HTTPException(429, 'Too many attempts. Try again in 15 minutes.', headers={'Retry-After': '900'})
    return key


def clear_auth_rate(key: str) -> None:
    execute('DELETE FROM auth_rate_limits WHERE identity_hash=?', (key,))


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv('APP_ENV') == 'production':
        if os.getenv('COOKIE_SECURE', 'true').lower() in {'false', '0', 'no'}:
            raise RuntimeError('Production requires secure cookies')
        if not os.getenv('OWNER_EMAIL'):
            raise RuntimeError('Production requires OWNER_EMAIL')
        if os.getenv('ALLOW_REGISTRATION', 'true').lower() not in {'0', 'false', 'no'} and len(os.getenv('REGISTRATION_TOKEN', '')) < 32:
            raise RuntimeError('Open registration requires a strong REGISTRATION_TOKEN')
    initialize_database()
    bootstrap_owner_recovery()
    execute('DELETE FROM sessions WHERE expires_at<=?', (iso(),))
    yield


app = FastAPI(title='Model Lab API', version='2.0.0', docs_url='/api/docs', openapi_url='/api/openapi.json', lifespan=lifespan)
origins = [value.strip().rstrip('/') for value in os.getenv('FRONTEND_ORIGINS', 'http://localhost:3000').split(',') if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                   allow_methods=['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
                   allow_headers=['Content-Type', 'X-CSRF-Token', 'Authorization'], expose_headers=['X-Total-Count', 'X-Request-ID'])


@app.middleware('http')
async def browser_origin_guard(request: Request, call_next):
    request_id, start = uuid.uuid4().hex, time.perf_counter()
    if request.method in {'POST', 'PATCH', 'PUT', 'DELETE'}:
        origin = request.headers.get('origin')
        if origin and origin.rstrip('/') not in origins:
            return JSONResponse(status_code=403, content={'detail': 'Origin is not allowed'})
        size = request.headers.get('content-length')
        if size and size.isdigit() and int(size) > 4_100_000:
            return JSONResponse(status_code=413, content={'detail': 'Request is too large'})
    response = await call_next(request)
    response.headers.update({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
                             'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'X-Request-ID': request_id})
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'private, no-store'
    # Paths use route templates, never emails, ids, query values, credentials or bodies.
    route = request.scope.get('route')
    logger.info(json.dumps({'request_id': request_id, 'method': request.method,
                           'route': getattr(route, 'path', '/unknown'), 'status': response.status_code,
                           'duration_ms': round((time.perf_counter() - start) * 1000, 1)}))
    return response


@app.get('/api/health')
def health():
    return {'status': 'healthy'}


@app.get('/api/ready')
def ready():
    try:
        one('SELECT 1 AS ok')
    except Exception as exc:
        raise HTTPException(503, 'Database temporarily unavailable') from exc
    return {'status': 'ready'}


@app.post('/api/auth/recover')
def recover(payload: RecoveryInput, response: Response):
    result = recover_account(str(payload.email), payload.recovery_code, payload.password)
    response.delete_cookie(SESSION_COOKIE, path='/')
    return result


@app.post('/api/auth/recovery-code')
def recovery_code(payload: RecoveryCodeInput, user: MutatingUser):
    return replace_recovery_code(user.id, user.email, payload.password)


@app.post('/api/auth/register', status_code=201)
def register(payload: RegisterInput, response: Response, request: Request):
    if os.getenv('ALLOW_REGISTRATION', 'true').lower() in {'0', 'false', 'no'}:
        raise HTTPException(403, 'New account registration is disabled')
    rate_key = check_auth_rate(request, 'register')
    email, owner = str(payload.email).lower(), os.getenv('OWNER_EMAIL', '').strip().lower()
    setup = os.getenv('REGISTRATION_TOKEN', '')
    if owner and email != owner:
        raise HTTPException(403, 'Registration is restricted to the workspace owner')
    if setup and not hmac.compare_digest(payload.registration_token.encode(), setup.encode()):
        raise HTTPException(403, 'A valid private setup code is required')
    if one('SELECT id FROM users WHERE email=?', (email,)):
        raise HTTPException(409, 'An account with this email already exists')
    user_id, now = new_id('usr'), iso()
    try:
        execute('INSERT INTO users(id,email,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                (user_id, email, payload.display_name, hash_password(payload.password), now, now))
    except Exception as exc:
        if one('SELECT id FROM users WHERE email=?', (email,)):
            raise HTTPException(409, 'An account with this email already exists') from exc
        raise
    csrf = create_session(user_id, response)
    clear_auth_rate(rate_key)
    return {'user': {'id': user_id, 'email': email, 'displayName': payload.display_name}, 'csrfToken': csrf}


@app.post('/api/auth/login')
def login(payload: LoginInput, response: Response, request: Request):
    rate_key = check_auth_rate(request, str(payload.email))
    row = one('SELECT id,email,display_name,password_hash FROM users WHERE email=?', (str(payload.email).lower(),))
    if not verify_password(payload.password, row.get('password_hash') if row else None):
        raise HTTPException(401, 'Incorrect email or password')
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        current = conn.execute('SELECT password_hash FROM users WHERE id=?', (row['id'],)).fetchone()
        if not current or current[0] != row['password_hash']:
            raise HTTPException(401, 'Credentials changed. Sign in again.')
        csrf = create_session(row['id'], response, conn)
    clear_auth_rate(rate_key)
    return {'user': {'id': row['id'], 'email': row['email'], 'displayName': row['display_name']}, 'csrfToken': csrf}


@app.get('/api/auth/me')
def me(user: CurrentUser):
    return {'user': public_user(user)}


@app.get('/api/auth/csrf')
def csrf(user: CurrentUser):
    return {'csrfToken': rotate_csrf(user)}


@app.post('/api/auth/logout', status_code=204)
def logout(request: Request, response: Response, _: MutatingUser):
    clear_session(response, request.cookies.get(SESSION_COOKIE))


@app.patch('/api/auth/profile')
def profile(payload: ProfileInput, user: MutatingUser):
    execute('UPDATE users SET display_name=?,updated_at=? WHERE id=?', (payload.display_name, iso(), user.id))
    return {'user': {**public_user(user), 'displayName': payload.display_name}}


@app.post('/api/auth/password')
def change_password(payload: PasswordInput, user: MutatingUser, request: Request, response: Response):
    key = check_auth_rate(request, 'password:' + user.email)
    row = one('SELECT password_hash FROM users WHERE id=?', (user.id,))
    if not verify_password(payload.current_password, row['password_hash'] if row else None):
        raise HTTPException(400, 'Incorrect current password')
    hashed = hash_password(payload.password)
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        changed = conn.execute('UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND password_hash=? RETURNING id',
                               (hashed, iso(), user.id, row['password_hash'])).fetchone()
        if not changed:
            raise HTTPException(409, 'Your password changed. Sign in again.')
        conn.execute('DELETE FROM sessions WHERE user_id=?', (user.id,))
        conn.execute('DELETE FROM api_tokens WHERE user_id=?', (user.id,))
        csrf_token = create_session(user.id, response, conn)
    clear_auth_rate(key)
    return {'user': public_user(user), 'csrfToken': csrf_token}


@app.get('/api/auth/sessions')
def sessions(user: CurrentUser):
    rows = query("SELECT COALESCE(id,'ses_' || substr(token_hash,1,24)) AS id,created_at,expires_at,token_hash FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC", (user.id, iso()))
    return [{key: value for key, value in {**row, 'current': row['token_hash'] == user.session_hash}.items() if key != 'token_hash'} for row in rows]


@app.delete('/api/auth/sessions', status_code=204)
def revoke_other_sessions(user: MutatingUser):
    execute('DELETE FROM sessions WHERE user_id=? AND token_hash!=?', (user.id, user.session_hash))


@app.delete('/api/auth/sessions/{record_id}', status_code=204)
def revoke_session(record_id: str, user: MutatingUser, response: Response):
    row = one("SELECT token_hash FROM sessions WHERE COALESCE(id,'ses_' || substr(token_hash,1,24))=? AND user_id=?", (record_id, user.id))
    if not row:
        raise HTTPException(404, 'Session not found')
    execute("DELETE FROM sessions WHERE COALESCE(id,'ses_' || substr(token_hash,1,24))=? AND user_id=?", (record_id, user.id))
    if row['token_hash'] == user.session_hash:
        response.delete_cookie(SESSION_COOKIE, path='/')


TOKEN_FIELDS = 'id,name,prefix,scopes,project_id,created_at,expires_at,last_used_at'


@app.get('/api/auth/tokens')
def list_tokens(user: CurrentUser):
    rows = query(f'SELECT {TOKEN_FIELDS} FROM api_tokens WHERE user_id=? ORDER BY created_at DESC', (user.id,))
    return [{**row, 'scopes': json.loads(row['scopes'])} for row in rows]


@app.post('/api/auth/tokens', status_code=201)
def create_token(payload: TokenInput, user: MutatingUser, request: Request):
    key = check_auth_rate(request, 'token:' + user.email)
    row = one('SELECT password_hash FROM users WHERE id=?', (user.id,))
    if not verify_password(payload.password, row['password_hash'] if row else None):
        raise HTTPException(400, 'Incorrect password')
    if payload.project_id:
        require_owned('projects', payload.project_id, user)
    token, record_id = 'ml_' + secrets.token_urlsafe(40), new_id('tok')
    metadata = {'id': record_id, 'name': payload.name, 'prefix': token[:10], 'scopes': payload.scopes,
                'project_id': payload.project_id, 'created_at': iso(),
                'expires_at': iso(utcnow() + timedelta(days=payload.expires_days)), 'last_used_at': None}
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        current = conn.execute('SELECT password_hash FROM users WHERE id=?', (user.id,)).fetchone()
        session = conn.execute('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',
                               (user.session_hash, user.id, iso())).fetchone()
        if not current or current[0] != row['password_hash'] or not session:
            raise HTTPException(409, 'Your credentials changed. Sign in again.')
        if conn.execute('SELECT COUNT(*) FROM api_tokens WHERE user_id=?', (user.id,)).fetchone()[0] >= 50:
            raise HTTPException(422, 'Revoke an existing token before creating another (maximum 50)')
        conn.execute("""INSERT INTO api_tokens(id,user_id,token_hash,name,prefix,scopes,project_id,created_at,expires_at)
            VALUES(?,?,?,?,?,?,?,?,?)""", (record_id, user.id, digest(token), payload.name, metadata['prefix'],
            json.dumps(payload.scopes), payload.project_id, metadata['created_at'], metadata['expires_at']))
    clear_auth_rate(key)
    return {**metadata, 'token': token}


@app.delete('/api/auth/tokens/{record_id}', status_code=204)
def revoke_token(record_id: str, user: MutatingUser):
    if not one('SELECT id FROM api_tokens WHERE id=? AND user_id=?', (record_id, user.id)):
        raise HTTPException(404, 'API token not found')
    execute('DELETE FROM api_tokens WHERE id=? AND user_id=?', (record_id, user.id))


def score_sql(run='r', experiment='e') -> str:
    condition = f"me.run_id={run}.id AND me.name={experiment}.primary_metric AND (me.split='' OR me.split={experiment}.metric_split) AND (me.unit='' OR me.unit={experiment}.metric_unit)"
    return f'''CASE WHEN {experiment}.metric_policy_confirmed=0 THEN NULL
        WHEN {experiment}.metric_aggregation='final' THEN
        (SELECT me.value FROM metrics me WHERE {condition} ORDER BY COALESCE(me.step,-1) DESC,me.logged_at DESC,me.rowid DESC LIMIT 1)
        WHEN {experiment}.metric_direction='min' THEN (SELECT MIN(me.value) FROM metrics me WHERE {condition})
        ELSE (SELECT MAX(me.value) FROM metrics me WHERE {condition}) END'''


POLICY_SELECT = ','.join('e.' + name for name in POLICY_FIELDS)
RUN_SELECT = f'''SELECT r.*,e.name AS experiment_name,e.project_id,p.name AS project_name,m.name AS model_name,m.id AS model_id,mv.version AS model_version,
    {POLICY_SELECT},{score_sql()} AS score,(SELECT COUNT(*) FROM metrics me WHERE me.run_id=r.id) AS metric_count
    FROM runs r JOIN experiments e ON e.id=r.experiment_id JOIN projects p ON p.id=e.project_id
    LEFT JOIN model_versions mv ON mv.id=r.model_version_id LEFT JOIN models m ON m.id=mv.model_id'''
SELECTS = {
    'projects': '''SELECT p.*,(SELECT COUNT(*) FROM experiments e WHERE e.project_id=p.id) AS experiments,
        (SELECT COUNT(*) FROM datasets d WHERE d.project_id=p.id) AS datasets,(SELECT COUNT(*) FROM models m WHERE m.project_id=p.id) AS models FROM projects p''',
    'datasets': 'SELECT d.*,p.name AS project_name FROM datasets d JOIN projects p ON p.id=d.project_id',
    'models': 'SELECT m.*,p.name AS project_name,(SELECT COUNT(*) FROM model_versions v WHERE v.model_id=m.id) AS versions FROM models m JOIN projects p ON p.id=m.project_id',
    'experiments': '''SELECT e.*,p.name AS project_name,d.name AS dataset_name,m.name AS model_name,
        (SELECT COUNT(*) FROM runs r WHERE r.experiment_id=e.id) AS runs FROM experiments e JOIN projects p ON p.id=e.project_id
        LEFT JOIN datasets d ON d.id=e.dataset_id LEFT JOIN models m ON m.id=e.model_id''',
    'runs': RUN_SELECT,
    'model_versions': 'SELECT v.*,m.name AS model_name,m.project_id FROM model_versions v JOIN models m ON m.id=v.model_id',
}
ALIASES = dict(zip(('projects', 'datasets', 'models', 'experiments', 'runs', 'model_versions'), ('p', 'd', 'm', 'e', 'r', 'v')))
PROJECT_SQL = {'projects': 'p.id', 'datasets': 'd.project_id', 'models': 'm.project_id', 'experiments': 'e.project_id', 'runs': 'e.project_id', 'model_versions': 'm.project_id'}


def run_decode(row):
    row = decode(row)
    if row is not None and 'score' in row:
        row['best_accuracy'] = row['score'] if 'accuracy' in row.get('primary_metric', '') and row.get('metric_unit') == 'fraction' else None
    return row


def filtered(resource, user, *, project_id=None, experiment_id=None, status=None, q=None, archived=None):
    alias = ALIASES[resource]
    clauses, params = [f'{alias}.user_id=?'], [user.id]
    if user.project_id:
        clauses.append(PROJECT_SQL[resource] + '=?')
        params.append(user.project_id)
    if project_id:
        clauses.append(PROJECT_SQL[resource] + '=?')
        params.append(project_id)
    if experiment_id and resource == 'runs':
        clauses.append('r.experiment_id=?')
        params.append(experiment_id)
    if status and resource in {'models', 'experiments', 'runs'}:
        clauses.append(f'{alias}.status=?')
        params.append(status)
    if q:
        clauses.append(f"({alias}.name LIKE ? ESCAPE '\\' OR {alias}.tags LIKE ? ESCAPE '\\')" if resource != 'model_versions' else 'v.version LIKE ?')
        escaped = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        params.extend(['%' + escaped + '%'] * (1 if resource == 'model_versions' else 2))
    if archived is not None and resource == 'projects':
        clauses.append('p.archived_at IS ' + ('NOT NULL' if archived else 'NULL'))
    return SELECTS[resource] + ' WHERE ' + ' AND '.join(clauses), params


def resource_rows(resource, user, **filters):
    sql, params = filtered(resource, user, **filters)
    order = ALIASES[resource] + ('.created_at' if resource in {'runs', 'model_versions'} else '.updated_at')
    return [run_decode(row) for row in query(sql + f' ORDER BY {order} DESC,{ALIASES[resource]}.id DESC', params)]


def make_list(resource):
    def endpoint(user: CurrentUser, response: Response, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                 q: str | None = Query(None, max_length=120), project_id: str | None = None,
                 experiment_id: str | None = None, status: str | None = None, archived: bool | None = None,
                 sort: str = Query('updated_desc', pattern='^(updated|name|created|updated_desc|created_desc|created_asc|name_asc|name_desc)$'), model_id: str | None = None):
        sql, params = filtered(resource, user, project_id=project_id, experiment_id=experiment_id, status=status, q=q, archived=archived)
        alias = ALIASES[resource]
        if model_id and resource == 'model_versions':
            sql += ' AND v.model_id=?'
            params.append(model_id)
        kind = sort.split('_')[0]
        column = ('version' if resource == 'model_versions' else 'name') if kind == 'name' else ('created_at' if kind == 'created' or resource in {'runs', 'model_versions'} else 'updated_at')
        direction = 'ASC' if sort.endswith('_asc') or sort == 'name' else 'DESC'
        with read_connection() as reader:
            response.headers['X-Total-Count'] = str(reader.one('SELECT COUNT(*) AS count FROM (' + sql + ')', params)['count'])
            rows = reader.query(sql + f' ORDER BY {alias}.{column} {direction},{alias}.id DESC LIMIT ? OFFSET ?', [*params, limit, offset])
        return [run_decode(row) for row in rows]
    endpoint.__name__ = 'list_' + resource
    return endpoint


for _resource in ('projects', 'datasets', 'models', 'experiments', 'runs', 'model_versions'):
    app.add_api_route('/api/' + _resource.replace('_', '-'), make_list(_resource), methods=['GET'])


def detail(resource, record_id, user):
    owned = require_owned(resource, record_id, user)
    if resource in SELECTS:
        sql, params = filtered(resource, user)
        return run_decode(one(sql + f' AND {ALIASES[resource]}.id=?', [*params, record_id]))
    return owned


def make_detail(resource):
    def endpoint(record_id: str, user: CurrentUser):
        return detail(resource, record_id, user)
    endpoint.__name__ = 'get_' + resource
    return endpoint


for _resource in ('projects', 'datasets', 'models', 'experiments', 'runs', 'model_versions'):
    app.add_api_route('/api/' + _resource.replace('_', '-') + '/{record_id}', make_detail(_resource), methods=['GET'])


def values_for_db(payload):
    values = dict(payload)
    for field in JSON_FIELDS:
        if field in values:
            values[field] = json.dumps(values[field], separators=(',', ':'), allow_nan=False, ensure_ascii=False)
    if 'archived' in values:
        values['archived_at'] = iso() if values.pop('archived') else None
    return values


def insert_record(table, values, conn=None):
    columns = list(values)
    sql = f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})"
    if conn:
        conn.execute(sql, tuple(values.values()))
    else:
        execute(sql, tuple(values.values()))


def validate_links(resource, data, user):
    if resource in {'datasets', 'models', 'experiments'}:
        require_owned('projects', data['project_id'], user)
    if resource == 'experiments':
        for key, table in (('dataset_id', 'datasets'), ('model_id', 'models')):
            if data.get(key) and require_owned(table, data[key], user)['project_id'] != data['project_id']:
                raise HTTPException(422, 'Dataset and model must belong to the selected project')
    if resource == 'runs':
        experiment = require_owned('experiments', data['experiment_id'], user)
        if data.get('model_version_id'):
            version = require_owned('model_versions', data['model_version_id'], user)
            model = require_owned('models', version['model_id'], user)
            if model['project_id'] != experiment['project_id'] or (experiment['model_id'] and model['id'] != experiment['model_id']):
                raise HTTPException(422, "Model version must match the experiment's project and model")
        if data.get('parent_run_id') and require_owned('runs', data['parent_run_id'], user)['experiment_id'] != data['experiment_id']:
            raise HTTPException(422, 'Parent run must belong to the same experiment')


def create_resource(resource, payload, user):
    data = payload.model_dump()
    validate_links(resource, data, user)
    record_id, now = new_id(PREFIXES[resource]), iso()
    values = {'id': record_id, 'user_id': user.id, **values_for_db(data), 'created_at': now, 'updated_at': now}
    insert_record(resource, values)
    return detail(resource, record_id, user)


@app.post('/api/projects', status_code=201)
def create_project(payload: ProjectInput, user: MutatingUser):
    if user.project_id:
        raise HTTPException(403, 'Project-scoped tokens cannot create projects')
    return create_resource('projects', payload, user)


@app.post('/api/datasets', status_code=201)
def create_dataset(payload: DatasetInput, user: MutatingUser):
    return create_resource('datasets', payload, user)


@app.post('/api/models', status_code=201)
def create_model(payload: ModelInput, user: MutatingUser):
    return create_resource('models', payload, user)


@app.post('/api/experiments', status_code=201)
def create_experiment(payload: ExperimentInput, user: MutatingUser):
    return create_resource('experiments', payload, user)


def sync_experiment_status(conn: Any, experiment_id: str, updated_at: str):
    conn.execute('''UPDATE experiments SET status=CASE
        WHEN EXISTS(SELECT 1 FROM runs WHERE experiment_id=experiments.id AND status IN ('queued','running')) THEN 'running'
        WHEN EXISTS(SELECT 1 FROM runs WHERE experiment_id=experiments.id AND status='completed') THEN 'completed'
        WHEN EXISTS(SELECT 1 FROM runs WHERE experiment_id=experiments.id AND status='failed') THEN 'failed'
        ELSE 'draft' END,updated_at=? WHERE id=? AND status!='archived' ''', (updated_at, experiment_id))


@app.post('/api/runs', status_code=201)
def create_run(payload: RunInput, user: MutatingUser):
    data = payload.model_dump()
    validate_links('runs', data, user)
    record_id, now = new_id('run'), iso()
    values = {'id': record_id, 'user_id': user.id, **values_for_db(data), 'created_at': now,
              'started_at': '' if payload.status == 'queued' else now, 'ended_at': now if payload.status in TERMINAL else None}
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        insert_record('runs', values, conn)
        sync_experiment_status(conn, payload.experiment_id, now)
    return detail('runs', record_id, user)


def patch_resource(resource, record_id, payload, user):
    old = require_owned(resource, record_id, user)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return detail(resource, record_id, user)
    # Moving an established record would invalidate its children's relationships.
    for key in ('project_id', 'experiment_id', 'model_id'):
        if key in changes and key in old and changes[key] != old[key] and not (resource == 'experiments' and key == 'model_id'):
            raise HTTPException(422, 'Parent relationships cannot be changed; create a copy instead')
    full = {key: value for key, value in old.items() if key in INPUTS[resource].model_fields}
    full.update(changes)
    try:
        INPUTS[resource].model_validate(full)
    except ValidationError as exc:
        raise HTTPException(422, 'Invalid resource fields') from exc
    validate_links(resource, full, user)
    if resource == 'runs' and full.get('parent_run_id'):
        ancestor, visited = full['parent_run_id'], set()
        while ancestor:
            if ancestor == record_id or ancestor in visited:
                raise HTTPException(422, 'Parent runs cannot form a cycle')
            visited.add(ancestor)
            parent = require_owned('runs', ancestor, user)
            ancestor = parent.get('parent_run_id')
    if resource == 'experiments' and 'model_id' in changes:
        bad = one('''SELECT r.id FROM runs r JOIN model_versions v ON v.id=r.model_version_id
                     WHERE r.experiment_id=? AND v.model_id!=? LIMIT 1''', (record_id, changes['model_id'])) if changes['model_id'] else None
        if bad:
            raise HTTPException(409, 'Existing runs use another model; keep the experiment model or create a copy')
    now = iso()
    values = values_for_db(changes)
    if resource not in {'runs', 'model_versions'}:
        values['updated_at'] = now
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if resource == 'runs' and 'status' in changes:
            state = changes['status']
            values['started_at'] = old['started_at'] or ('' if state == 'queued' else now)
            values['ended_at'] = (old['ended_at'] or now) if state in TERMINAL else None
        if resource == 'experiments' and changes.get('status') not in {None, 'archived'}:
            if conn.execute('SELECT 1 FROM runs WHERE experiment_id=? LIMIT 1', (record_id,)).fetchone():
                # Unarchive, then recompute from the complete run history.
                values['status'] = 'draft'
        assignments = ','.join(key + '=?' for key in values)
        conn.execute(f'UPDATE {resource} SET {assignments} WHERE id=? AND user_id=?', [*values.values(), record_id, user.id])
        if resource == 'runs':
            sync_experiment_status(conn, old['experiment_id'], now)
        elif resource == 'experiments' and changes.get('status') not in {None, 'archived'}:
            sync_experiment_status(conn, record_id, now)
        elif resource == 'model_versions':
            conn.execute('UPDATE models SET updated_at=? WHERE id=?', (now, old['model_id']))
    return detail(resource, record_id, user)


@app.patch('/api/projects/{record_id}')
def update_project(record_id: str, payload: ProjectPatch, user: MutatingUser):
    return patch_resource('projects', record_id, payload, user)


@app.patch('/api/datasets/{record_id}')
def update_dataset(record_id: str, payload: DatasetPatch, user: MutatingUser):
    return patch_resource('datasets', record_id, payload, user)


@app.patch('/api/models/{record_id}')
def update_model(record_id: str, payload: ModelPatch, user: MutatingUser):
    return patch_resource('models', record_id, payload, user)


@app.patch('/api/experiments/{record_id}')
def update_experiment(record_id: str, payload: ExperimentPatch, user: MutatingUser):
    return patch_resource('experiments', record_id, payload, user)


@app.patch('/api/runs/{record_id}')
def update_run(record_id: str, payload: RunPatch, user: MutatingUser):
    return patch_resource('runs', record_id, payload, user)


@app.patch('/api/model-versions/{record_id}')
def update_version(record_id: str, payload: ModelVersionPatch, user: MutatingUser):
    old = require_owned('model_versions', record_id, user)
    if 'version' in payload.model_fields_set and payload.version != old['version']:
        raise HTTPException(422, 'A version name is immutable; register a new version')
    return patch_resource('model_versions', record_id, payload, user)


@app.patch('/api/experiments/{record_id}/status')
def update_experiment_status(record_id: str, payload: ExperimentStatusInput, user: MutatingUser):
    return patch_resource('experiments', record_id, payload, user)


@app.patch('/api/runs/{record_id}/status')
def update_run_status(record_id: str, payload: RunStatusInput, user: MutatingUser):
    return patch_resource('runs', record_id, payload, user)


@app.get('/api/models/{record_id}/versions')
def list_versions(record_id: str, user: CurrentUser, response: Response, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    require_owned('models', record_id, user)
    response.headers['X-Total-Count'] = str(one('SELECT COUNT(*) AS count FROM model_versions WHERE model_id=?', (record_id,))['count'])
    return query('SELECT * FROM model_versions WHERE model_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?', (record_id, limit, offset))


@app.post('/api/models/{record_id}/versions', status_code=201)
def create_version(record_id: str, payload: ModelVersionInput, user: MutatingUser):
    require_owned('models', record_id, user)
    version_id, now = new_id('ver'), iso()
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute('SELECT id FROM model_versions WHERE model_id=? AND version=?', (record_id, payload.version)).fetchone():
            raise HTTPException(409, 'This model version already exists')
        insert_record('model_versions', {'id': version_id, 'model_id': record_id, 'user_id': user.id, **payload.model_dump(), 'created_at': now}, conn)
        conn.execute('UPDATE models SET updated_at=? WHERE id=?', (now, record_id))
    return detail('model_versions', version_id, user)


def deletion_counts(resource, record_id, user):
    require_owned(resource, record_id, user)
    counts = {name: 0 for name in TABLES}
    if resource == 'projects':
        for table in ('datasets', 'models', 'experiments'):
            counts[table] = one(f'SELECT COUNT(*) AS count FROM {table} WHERE project_id=?', (record_id,))['count']
        counts['model_versions'] = one('SELECT COUNT(*) AS count FROM model_versions WHERE model_id IN (SELECT id FROM models WHERE project_id=?)', (record_id,))['count']
        counts['runs'] = one('SELECT COUNT(*) AS count FROM runs WHERE experiment_id IN (SELECT id FROM experiments WHERE project_id=?)', (record_id,))['count']
        counts['metrics'] = one('SELECT COUNT(*) AS count FROM metrics WHERE run_id IN (SELECT r.id FROM runs r JOIN experiments e ON e.id=r.experiment_id WHERE e.project_id=?)', (record_id,))['count']
    elif resource == 'experiments':
        counts['runs'] = one('SELECT COUNT(*) AS count FROM runs WHERE experiment_id=?', (record_id,))['count']
        counts['metrics'] = one('SELECT COUNT(*) AS count FROM metrics WHERE run_id IN (SELECT id FROM runs WHERE experiment_id=?)', (record_id,))['count']
    elif resource == 'models':
        counts['model_versions'] = one('SELECT COUNT(*) AS count FROM model_versions WHERE model_id=?', (record_id,))['count']
    elif resource == 'runs':
        counts['metrics'] = one('SELECT COUNT(*) AS count FROM metrics WHERE run_id=?', (record_id,))['count']
    return counts


def make_preview(resource):
    def endpoint(record_id: str, user: CurrentUser):
        record = require_owned(resource, record_id, user)
        counts = deletion_counts(resource, record_id, user)
        return {'resource': resource, 'id': record_id, 'name': record.get('name', record.get('version', '')), 'counts': counts, 'total': sum(counts.values())}
    endpoint.__name__ = 'preview_delete_' + resource
    return endpoint


def make_delete(resource):
    def endpoint(record_id: str, user: MutatingUser):
        row = require_owned(resource, record_id, user)
        with DB_LOCK, connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute(f'DELETE FROM {resource} WHERE id=? AND user_id=?', (record_id, user.id))
            if resource == 'runs':
                sync_experiment_status(conn, row['experiment_id'], iso())
    endpoint.__name__ = 'delete_' + resource
    return endpoint


for _resource in ('projects', 'datasets', 'models', 'experiments', 'runs', 'model_versions'):
    _path = '/api/' + _resource.replace('_', '-') + '/{record_id}'
    app.add_api_route(_path + '/deletion-preview', make_preview(_resource), methods=['GET'])
    app.add_api_route(_path, make_delete(_resource), methods=['DELETE'], status_code=204)


def validate_metric(payload, experiment):
    unit = payload.unit or (experiment['metric_unit'] if payload.name == experiment['primary_metric'] else 'number')
    if unit == 'fraction' and not 0 <= payload.value <= 1:
        raise HTTPException(422, 'Fraction metrics must be between 0 and 1; use percent or a numeric unit for other values')
    if unit == 'percent' and not 0 <= payload.value <= 100:
        raise HTTPException(422, 'Percent metrics must be between 0 and 100')
    return {**payload.model_dump(), 'unit': unit, 'split': payload.split or (experiment['metric_split'] if payload.name == experiment['primary_metric'] else '')}


@app.get('/api/runs/{record_id}/metrics')
def list_metrics(record_id: str, user: CurrentUser, response: Response, name: str | None = Query(None, max_length=80),
                 limit: int = Query(500, ge=1, le=5000), offset: int = Query(0, ge=0), split: str | None = Query(None, max_length=40)):
    require_owned('runs', record_id, user)
    sql, params = 'SELECT * FROM metrics WHERE run_id=? AND user_id=?', [record_id, user.id]
    for key, value in (('name', name), ('split', split)):
        if value is not None:
            sql += f' AND {key}=?'
            params.append(value)
    with read_connection() as reader:
        response.headers['X-Total-Count'] = str(reader.one('SELECT COUNT(*) AS count FROM (' + sql + ')', params)['count'])
        return reader.query(sql + ' ORDER BY name,COALESCE(step,2147483647),logged_at,rowid LIMIT ? OFFSET ?', [*params, limit, offset])


@app.post('/api/runs/{record_id}/metrics', status_code=201)
def create_metric(record_id: str, payload: MetricInput, user: MutatingUser):
    run = require_owned('runs', record_id, user)
    experiment = require_owned('experiments', run['experiment_id'], user)
    metric_data = validate_metric(payload, experiment)
    metric_id = new_id('met')
    insert_record('metrics', {'id': metric_id, 'run_id': record_id, 'user_id': user.id, **metric_data, 'logged_at': iso()})
    return one('SELECT * FROM metrics WHERE id=?', (metric_id,))


@app.post('/api/runs/{record_id}/metrics/batch')
def metric_batch(record_id: str, payload: MetricBatchInput, user: MutatingUser):
    run = require_owned('runs', record_id, user)
    experiment = require_owned('experiments', run['experiment_id'], user)
    payload_hash = hashlib.sha256(json.dumps([metric.model_dump() for metric in payload.metrics], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        existing = conn.execute('SELECT payload_hash,result FROM metric_batches WHERE user_id=? AND run_id=? AND idempotency_key=?',
                                (user.id, record_id, payload.idempotency_key)).fetchone()
        if existing:
            if existing[0] != payload_hash:
                raise HTTPException(409, 'Idempotency key was already used with a different batch')
            return {'metrics': json.loads(existing[1]), 'replayed': True}
        rows = [{'id': new_id('met'), 'run_id': record_id, 'user_id': user.id, **validate_metric(metric, experiment), 'logged_at': iso()} for metric in payload.metrics]
        for row in rows:
            insert_record('metrics', row, conn)
        conn.execute('INSERT INTO metric_batches(user_id,run_id,idempotency_key,payload_hash,result,created_at) VALUES(?,?,?,?,?,?)',
                     (user.id, record_id, payload.idempotency_key, payload_hash, json.dumps(rows, separators=(',', ':')), iso()))
    return {'metrics': rows, 'replayed': False}


@app.get('/api/leaderboard')
def leaderboard(user: CurrentUser, response: Response, experiment_id: str | None = None, project_id: str | None = None,
                limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    if experiment_id:
        require_owned('experiments', experiment_id, user)
    sql, params = filtered('runs', user, experiment_id=experiment_id, project_id=project_id, status='completed')
    with read_connection() as reader:
        response.headers['X-Total-Count'] = str(reader.one('SELECT COUNT(*) AS count FROM (' + sql + ') WHERE score IS NOT NULL', params)['count'])
        rows = reader.query('WITH scored AS (' + sql + """),ranked AS (
            SELECT *,RANK() OVER (PARTITION BY experiment_id ORDER BY CASE WHEN metric_direction='min' THEN score ELSE -score END) AS rank
            FROM scored WHERE score IS NOT NULL)
            SELECT * FROM ranked ORDER BY experiment_name,experiment_id,rank,id LIMIT ? OFFSET ?""", [*params, limit, offset])
    return [{**run_decode(row), 'run': row['name'], 'experiment': row['experiment_name'],
             'model': row['model_name'], 'version': row['model_version']} for row in rows]


@app.get('/api/dashboard')
def dashboard(user: CurrentUser, experiment_id: str | None = None):
    if experiment_id:
        require_owned('experiments', experiment_id, user)
    # Authentication opens one connection; all dashboard reads share the next one.
    # Counts and model rankings are computed in SQL, never by loading all account runs.
    with read_connection() as reader:
        project_filter = ' AND p.id=?' if user.project_id else ''
        model_filter = ' AND m.project_id=?' if user.project_id else ''
        experiment_filter = ' AND e.project_id=?' if user.project_id else ''
        params = [user.id, user.project_id] if user.project_id else [user.id]
        projects = reader.one('SELECT COUNT(*) AS count FROM projects p WHERE p.user_id=?' + project_filter, params)['count']
        models = reader.one('SELECT COUNT(*) AS count FROM models m WHERE m.user_id=?' + model_filter, params)['count']
        experiments = reader.one('SELECT COUNT(*) AS count FROM experiments e WHERE e.user_id=?' + experiment_filter, params)['count']
        versions = reader.one('SELECT COUNT(*) AS count FROM model_versions v JOIN models m ON m.id=v.model_id WHERE v.user_id=?' + model_filter, params)['count']
        selected_sql = 'SELECT e.* FROM experiments e WHERE e.user_id=?' + experiment_filter
        selected_params = list(params)
        if experiment_id:
            selected_sql += ' AND e.id=?'
            selected_params.append(experiment_id)
        else:
            selected_sql += " AND e.status!='archived'"
        selected = reader.one(selected_sql + ' ORDER BY e.updated_at DESC,e.id DESC LIMIT 1', selected_params)
        run_sql, run_params = filtered('runs', user)
        count = reader.one('SELECT COUNT(*) AS count FROM runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.user_id=?' + experiment_filter, params)['count']
        recent = [run_decode(row) for row in reader.query(run_sql + ' ORDER BY r.created_at DESC,r.id DESC LIMIT 5', run_params)]
        best, trend = None, []
        metric_policy = None
        if selected:
            aggregate = 'MIN' if selected['metric_direction'] == 'min' else 'MAX'
            selected_run_sql = run_sql + " AND e.id=? AND r.status='completed'"
            selected_params = [*run_params, selected['id']]
            best = reader.one('SELECT ' + aggregate + '(score) AS score FROM (' + selected_run_sql + ')', selected_params)['score']
            metric_policy = {'name': selected['primary_metric'], 'direction': selected['metric_direction'],
                             'aggregation': selected['metric_aggregation'], 'unit': selected['metric_unit'],
                             'split': selected['metric_split'], 'confirmed': bool(selected['metric_policy_confirmed']),
                             'experimentId': selected['id'], 'experimentName': selected['name']}
            # First apply the experiment's aggregation within each run/day, then
            # select the day's winner. A final policy never takes an earlier peak.
            daily_value = 'MAX(CASE WHEN reading_order=1 THEN value END)' if selected['metric_aggregation'] == 'final' else aggregate + '(value)'
            trend = reader.query(f"""WITH readings AS (
                SELECT me.value,r.id AS run_id,substr(me.logged_at,1,10) AS day,
                  ROW_NUMBER() OVER (PARTITION BY r.id,substr(me.logged_at,1,10)
                    ORDER BY COALESCE(me.step,-1) DESC,me.logged_at DESC,me.rowid DESC) AS reading_order
                FROM metrics me JOIN runs r ON r.id=me.run_id
                WHERE r.experiment_id=? AND r.user_id=? AND me.name=? AND ?=1
                  AND (me.split='' OR me.split=?) AND (me.unit='' OR me.unit=?)),
                daily_runs AS (SELECT day,run_id,{daily_value} AS value FROM readings GROUP BY day,run_id)
                SELECT day,{aggregate}(value) AS value FROM daily_runs GROUP BY day ORDER BY day DESC LIMIT 14""",
                (selected['id'], user.id, selected['primary_metric'], int(selected['metric_policy_confirmed']), selected['metric_split'], selected['metric_unit']))
            top = reader.query(f"""WITH scored AS ({selected_run_sql}),
                model_scores AS (SELECT model_id,{aggregate}(score) AS score FROM scored GROUP BY model_id)
                SELECT m.*,p.name AS project,(SELECT COUNT(*) FROM model_versions v WHERE v.model_id=m.id) AS versions,ms.score
                FROM models m JOIN projects p ON p.id=m.project_id LEFT JOIN model_scores ms ON ms.model_id=m.id
                WHERE m.user_id=?{model_filter} ORDER BY ms.score IS NULL,ms.score {'ASC' if aggregate == 'MIN' else 'DESC'},m.updated_at DESC LIMIT 6""",
                [*selected_params, *params])
        else:
            top = reader.query('SELECT m.*,p.name AS project,(SELECT COUNT(*) FROM model_versions v WHERE v.model_id=m.id) AS versions,NULL AS score FROM models m JOIN projects p ON p.id=m.project_id WHERE m.user_id=?' + model_filter + ' ORDER BY m.updated_at DESC LIMIT 6', params)
        return {'stats': {'projects': projects, 'model_versions': versions, 'runs': count, 'best_score': best,
                          'best_accuracy': best if selected and 'accuracy' in selected['primary_metric'] and selected['metric_unit'] == 'fraction' else None},
                'selectedMetric': metric_policy, 'recentRuns': [{**row, 'experiment': row['experiment_name']} for row in recent],
                'trend': list(reversed(trend)), 'topModels': [decode(row) for row in top],
                'onboarding': {'projects': projects, 'models': models, 'experiments': experiments, 'runs': count}}


@app.get('/api/analytics')
def analytics(user: CurrentUser):
    with read_connection() as reader:
        scope = ' AND e.project_id=?' if user.project_id else ''
        params = [user.id, user.project_id] if user.project_id else [user.id]
        statuses = reader.query('SELECT r.status,COUNT(*) AS count FROM runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.user_id=?' + scope + ' GROUP BY r.status', params)
        model_scope = ' AND project_id=?' if user.project_id else ''
        frameworks = reader.query('SELECT framework,COUNT(*) AS count FROM models WHERE user_id=?' + model_scope + ' GROUP BY framework ORDER BY count DESC', params)
        project_scope = ' AND p.id=?' if user.project_id else ''
        storage = reader.query('SELECT p.name AS project,COUNT(d.id) AS datasets,COALESCE(SUM(d.size_bytes),0) AS bytes FROM projects p LEFT JOIN datasets d ON d.project_id=p.id WHERE p.user_id=?' + project_scope + ' GROUP BY p.id,p.name ORDER BY bytes DESC', params)
        names = reader.query('SELECT me.name,COUNT(*) AS readings FROM metrics me JOIN runs r ON r.id=me.run_id JOIN experiments e ON e.id=r.experiment_id WHERE me.user_id=?' + scope + ' GROUP BY me.name ORDER BY readings DESC LIMIT 12', params)
    return {'runStatuses': statuses, 'frameworks': frameworks, 'storage': storage, 'metricNames': names}


@app.get('/api/workspace/export')
def export_workspace(user: CurrentUser, project_id: str | None = None):
    if project_id:
        require_owned('projects', project_id, user)
    result = {'format': 'model-lab', 'version': 1, 'exportedAt': iso()}
    with read_connection(snapshot=True) as reader:
        projects = reader.query('SELECT * FROM projects WHERE user_id=?' + (' AND id=?' if project_id else ''), [user.id, *([project_id] if project_id else [])])
        ids = [row['id'] for row in projects]
        placeholders = ','.join('?' for _ in ids) or 'NULL'
        result['projects'] = [decode(row) for row in projects]
        for table in ('datasets', 'models', 'experiments'):
            result[table] = [decode(row) for row in reader.query(f'SELECT * FROM {table} WHERE user_id=? AND project_id IN ({placeholders})', [user.id, *ids])]
        result['model_versions'] = reader.query(f'SELECT v.* FROM model_versions v JOIN models m ON m.id=v.model_id WHERE v.user_id=? AND m.project_id IN ({placeholders})', [user.id, *ids])
        result['runs'] = [decode(row) for row in reader.query(f'SELECT r.* FROM runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.user_id=? AND e.project_id IN ({placeholders})', [user.id, *ids])]
        result['metrics'] = reader.query(f'SELECT me.* FROM metrics me JOIN runs r ON r.id=me.run_id JOIN experiments e ON e.id=r.experiment_id WHERE me.user_id=? AND e.project_id IN ({placeholders})', [user.id, *ids])
    # Exports contain workspace data only, never credential/session/recovery tables.
    for table in TABLES:
        for row in result[table]:
            row.pop('user_id', None)
    encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    return StreamingResponse(encoder.iterencode(result), media_type='application/json',
                             headers={'Content-Disposition': 'attachment; filename="model-lab-export.json"'})


def validate_import(data):
    if data.get('format') != 'model-lab' or data.get('version') != 1:
        raise HTTPException(422, 'Choose a Model Lab version 1 export')
    allowed = set(TABLES) | {'format', 'version', 'exportedAt'}
    if set(data) - allowed:
        raise HTTPException(422, 'Export contains unsupported sections')
    records, ids, all_ids = {}, {}, set()
    for table in TABLES:
        rows = data.get(table, [])
        if not isinstance(rows, list) or len(rows) > 50000:
            raise HTTPException(422, 'Each export section must contain at most 50,000 records')
        records[table], ids[table] = [], set()
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not 1 <= len(row['id']) <= 100 or row['id'] in all_ids:
                raise HTTPException(422, f'Invalid or duplicate id in {table}')
            ids[table].add(row['id'])
            all_ids.add(row['id'])
            for timestamp in ('created_at', 'updated_at', 'logged_at', 'started_at', 'ended_at', 'archived_at'):
                value = row.get(timestamp)
                if value is not None and value != '':
                    try:
                        from datetime import datetime
                        if not isinstance(value, str) or len(value) > 40 or datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is None:
                            raise ValueError('Timezone required')
                    except (ValueError, TypeError):
                        raise HTTPException(422, f'Invalid timestamp in {table}')
            fields = INPUTS[table].model_fields
            clean = {key: value for key, value in row.items() if key in fields}
            try:
                valid = INPUTS[table].model_validate(clean).model_dump()
            except ValidationError as exc:
                raise HTTPException(422, f'Invalid fields in {table}') from exc
            records[table].append({'id': row['id'], **valid, **{key: row.get(key) for key in ('model_id', 'run_id', 'created_at', 'updated_at', 'started_at', 'ended_at', 'logged_at', 'archived_at') if key not in valid and key in row}})
    relations = {'datasets': [('project_id', 'projects')], 'models': [('project_id', 'projects')],
                 'model_versions': [('model_id', 'models')], 'experiments': [('project_id', 'projects'), ('dataset_id', 'datasets'), ('model_id', 'models')],
                 'runs': [('experiment_id', 'experiments'), ('model_version_id', 'model_versions'), ('parent_run_id', 'runs')], 'metrics': [('run_id', 'runs')]}
    by_id = {table: {row['id']: row for row in rows} for table, rows in records.items()}
    versions = set()
    for row in records['model_versions']:
        model_id = row.get('model_id')
        if not isinstance(model_id, str) or not 1 <= len(model_id) <= 80:
            raise HTTPException(422, 'Invalid models reference in model_versions')
        key = (model_id, row['version'])
        if key in versions:
            raise HTTPException(422, 'A model cannot have duplicate version names in an import')
        versions.add(key)
    for table, links in relations.items():
        for row in records[table]:
            for key, target in links:
                if row.get(key) is not None and (not isinstance(row[key], str) or not 1 <= len(row[key]) <= 80):
                    raise HTTPException(422, f'Invalid {target} reference in {table}')
                if (key in {'project_id', 'experiment_id', 'run_id'} or (table == 'model_versions' and key == 'model_id')) and not row.get(key):
                    raise HTTPException(422, f'Missing {target} reference in {table}')
                if row.get(key) and row[key] not in ids[target]:
                    raise HTTPException(422, f'Missing {target} reference in {table}')
            if table == 'experiments':
                for key, target in (('dataset_id', 'datasets'), ('model_id', 'models')):
                    if row.get(key) and by_id[target][row[key]]['project_id'] != row['project_id']:
                        raise HTTPException(422, 'Imported experiment references a different project')
            if table == 'runs':
                exp = by_id['experiments'][row['experiment_id']]
                if row.get('model_version_id'):
                    version = by_id['model_versions'][row['model_version_id']]
                    model = by_id['models'][version['model_id']]
                    if model['project_id'] != exp['project_id'] or (exp['model_id'] and model['id'] != exp['model_id']):
                        raise HTTPException(422, 'Imported run model does not match its experiment')
                if row.get('parent_run_id'):
                    if row['parent_run_id'] == row['id'] or by_id['runs'][row['parent_run_id']]['experiment_id'] != row['experiment_id']:
                        raise HTTPException(422, 'Invalid parent run')
            if table == 'metrics':
                exp = by_id['experiments'][by_id['runs'][row['run_id']]['experiment_id']]
                validate_metric(MetricInput.model_validate({key: row[key] for key in MetricInput.model_fields}), exp)
    settled = set()
    for row in records['runs']:
        ancestor, chain = row['id'], set()
        while ancestor and ancestor not in settled:
            if ancestor in chain:
                raise HTTPException(422, 'Imported parent runs cannot form a cycle')
            chain.add(ancestor)
            ancestor = by_id['runs'][ancestor].get('parent_run_id')
        settled.update(chain)
    return records


@app.post('/api/workspace/import')
def import_workspace(payload: ImportInput, user: MutatingUser):
    records = validate_import(payload.data)
    counts = {table: len(records[table]) for table in TABLES}
    if payload.dry_run:
        return {'dryRun': True, 'counts': counts}
    remap = {row['id']: new_id(PREFIXES[table]) for table in TABLES for row in records[table]}
    with DB_LOCK, connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        pending_parents = []
        for table in TABLES:
            for row in records[table]:
                data = {key: value for key, value in row.items() if key in INPUTS[table].model_fields or key in {'model_id', 'run_id'}}
                for key in ('project_id', 'model_id', 'dataset_id', 'experiment_id', 'model_version_id', 'run_id'):
                    if data.get(key):
                        data[key] = remap[data[key]]
                if table == 'runs':
                    if data.get('parent_run_id'):
                        pending_parents.append((remap[data['parent_run_id']], remap[row['id']]))
                    data['parent_run_id'] = None
                values = {'id': remap[row['id']], 'user_id': user.id, **values_for_db(data)}
                if table == 'metrics':
                    values['logged_at'] = row.get('logged_at') or iso()
                else:
                    values['created_at'] = row.get('created_at') or iso()
                    if table not in {'model_versions', 'runs'}:
                        values['updated_at'] = row.get('updated_at') or values['created_at']
                    if table == 'runs':
                        values['started_at'] = row.get('started_at') or ('' if data['status'] == 'queued' else values['created_at'])
                        values['ended_at'] = row.get('ended_at') if data['status'] in TERMINAL else None
                insert_record(table, values, conn)
        for parent, child in pending_parents:
            conn.execute('UPDATE runs SET parent_run_id=? WHERE id=?', (parent, child))
        for experiment in records['experiments']:
            sync_experiment_status(conn, remap[experiment['id']], iso())
    return {'dryRun': False, 'counts': counts}
