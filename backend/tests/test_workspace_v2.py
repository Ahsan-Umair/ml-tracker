"""Regressions for metric policies, portable logging, editing and account controls."""
import copy
from fastapi.testclient import TestClient
from app.main import app, auth_attempts

PASSWORD = 'a-long-test-password'


def workspace(client):
    result = client.post('/api/auth/register', json={'display_name': 'Owner', 'email': 'owner@example.com', 'password': PASSWORD})
    assert result.status_code == 201
    headers = {'X-CSRF-Token': result.json()['csrfToken']}
    project = post(client, headers, '/projects', name='Vision', tags=['vision'])
    experiment = post(client, headers, '/experiments', name='Ablation', project_id=project['id'])
    return headers, project, experiment


def post(client, headers, path, **body):
    result = client.post('/api' + path, headers=headers, json=body)
    assert result.status_code in {200, 201}, result.text
    return result.json()


def run(client, headers, exp, name='Attempt', **extra):
    return post(client, headers, '/runs', name=name, experiment_id=exp['id'], **extra)


def metric(client, headers, run, name, value, step=1, **extra):
    return post(client, headers, f"/runs/{run['id']}/metrics", name=name, value=value, step=step, **extra)


def test_scoring_never_combines_metric_names_splits_or_units():
    with TestClient(app) as client:
        h, _, e = workspace(client)
        a = run(client, h, e, 'Overfit', status='completed')
        b = run(client, h, e, 'Generalizes', status='completed')
        metric(client, h, a, 'accuracy', .99)
        metric(client, h, a, 'val_accuracy', .7)
        metric(client, h, a, 'val_accuracy', .999, split='test')
        metric(client, h, a, 'val_accuracy', 98, unit='percent')
        metric(client, h, b, 'val_accuracy', .95)
        rows = client.get('/api/leaderboard').json()
        assert [r['id'] for r in rows] == [b['id'], a['id']]
        assert [r['score'] for r in rows] == [.95, .7]
        assert client.patch(f"/api/experiments/{e['id']}", headers=h, json={'primary_metric': 'val_loss', 'metric_direction': 'min', 'metric_unit': 'number'}).status_code == 200
        metric(client, h, a, 'val_loss', 2.5)
        metric(client, h, b, 'val_loss', .2)
        dashboard = client.get('/api/dashboard', params={'experiment_id': e['id']}).json()
        assert dashboard['stats']['best_score'] == .2
        assert dashboard['stats']['best_accuracy'] is None
        assert client.get('/api/leaderboard').json()[0]['id'] == b['id']


def test_final_aggregation_and_nonprimary_units():
    with TestClient(app) as client:
        h, _, e = workspace(client)
        r = run(client, h, e, status='completed')
        metric(client, h, r, 'val_accuracy', .95, step=1)
        metric(client, h, r, 'val_accuracy', .7, step=2)
        client.patch(f"/api/experiments/{e['id']}", headers=h, json={'metric_aggregation': 'final'})
        assert client.get(f"/api/runs/{r['id']}").json()['score'] == .7
        assert client.get('/api/dashboard').json()['trend'][-1]['value'] == .7
        assert metric(client, h, r, 'train_loss', 5)['unit'] == 'number'


def test_timestamps_and_derived_experiment_status(monkeypatch):
    with TestClient(app) as client:
        h, _, e = workspace(client)
        r = run(client, h, e, status='queued')
        assert r['started_at'] is None
        started = client.patch(f"/api/runs/{r['id']}/status", headers=h, json={'status': 'running'}).json()
        assert started['started_at']
        assert client.patch(f"/api/experiments/{e['id']}/status", headers=h, json={'status': 'completed'}).json()['status'] == 'running'
        ended = client.patch(f"/api/runs/{r['id']}/status", headers=h, json={'status': 'completed'}).json()
        monkeypatch.setattr('app.main.iso', lambda: '2040-01-01T00:00:00+00:00')
        repeated = client.patch(f"/api/runs/{r['id']}/status", headers=h, json={'status': 'completed'}).json()
        assert repeated['ended_at'] == ended['ended_at']
        assert repeated['started_at'] == started['started_at']


def test_edit_tags_pagination_details_archive_and_deletion_preview():
    with TestClient(app) as client:
        h, p, e = workspace(client)
        r = run(client, h, e, hyperparameters={'lr': .01}, provenance={'git_commit': 'abc'})
        metric(client, h, r, 'val_accuracy', .5)
        edited = client.patch(f"/api/projects/{p['id']}", headers=h, json={'description': 'Updated', 'archived': True})
        assert edited.status_code == 200, edited.text
        assert edited.json()['name'] == 'Vision' and edited.json()['archived'] is True
        assert edited.json()['tags'] == ['vision']
        assert client.patch(f"/api/projects/{p['id']}", headers=h, json={'name': None}).status_code == 422
        page = client.get('/api/projects', params={'q': 'vision', 'limit': 1, 'sort': 'name_asc'})
        assert page.headers['x-total-count'] == '1'
        assert client.get('/api/projects', params={'offset': 1}).json() == []
        counts = client.get(f"/api/projects/{p['id']}/deletion-preview").json()['counts']
        assert counts['experiments'] == counts['runs'] == counts['metrics'] == 1
        assert client.get(f"/api/runs/{r['id']}").json()['provenance'] == {'git_commit': 'abc'}


def test_model_version_promotions_and_conflicts():
    with TestClient(app) as client:
        h, p, _ = workspace(client)
        m = post(client, h, '/models', name='Model', project_id=p['id'])
        path = f"/models/{m['id']}/versions"
        v = post(client, h, path, version='v1', checksum='sha256:abc')
        assert client.post('/api' + path, headers=h, json={'version': 'v1'}).status_code == 409
        assert client.patch(f"/api/model-versions/{v['id']}", headers=h, json={'stage': 'production'}).json()['stage'] == 'production'
        assert client.patch(f"/api/model-versions/{v['id']}", headers=h, json={'version': 'changed'}).status_code == 422
        assert len(client.get('/api/model-versions', params={'model_id': m['id']}).json()) == 1


def test_project_scoped_tokens_batch_replays_and_revocation():
    with TestClient(app) as client:
        h, p, e = workspace(client)
        other = post(client, h, '/projects', name='Other')
        r = run(client, h, e)
        token = post(client, h, '/auth/tokens', name='Notebook', password=PASSWORD, project_id=p['id'], scopes=['read', 'metrics:write'])
        bearer = {'Authorization': 'Bearer ' + token['token']}
        assert 'token' not in client.get('/api/auth/tokens').json()[0]
        assert client.get(f"/api/projects/{other['id']}", headers=bearer).status_code == 404
        assert len(client.get('/api/projects', headers=bearer).json()) == 1
        assert client.get('/api/auth/sessions', headers=bearer).status_code == 403
        assert client.get('/api/workspace/export', headers=bearer).status_code == 403
        assert client.post('/api/projects', headers=bearer, json={'name': 'No'}).status_code == 403
        path = f"/api/runs/{r['id']}/metrics/batch"
        body = {'idempotency_key': 'batch-1', 'metrics': [{'name': 'val_accuracy', 'value': .8, 'step': 1}]}
        first = client.post(path, headers=bearer, json=body)
        assert first.status_code == 200, first.text
        assert first.json()['replayed'] is False
        assert client.post(path, headers=bearer, json=body).json()['replayed'] is True
        assert len(client.get(f"/api/runs/{r['id']}/metrics").json()) == 1
        body['metrics'][0]['value'] = .9
        assert client.post(path, headers=bearer, json=body).status_code == 409
        assert client.delete(f"/api/auth/tokens/{token['id']}", headers=h).status_code == 204
        assert client.get('/api/projects', headers=bearer).status_code == 401


def test_metrics_only_tokens_cannot_read_or_create():
    with TestClient(app) as client:
        h, _, e = workspace(client)
        r = run(client, h, e)
        token = post(client, h, '/auth/tokens', name='Logger', password=PASSWORD, scopes=['metrics:write'])
        bearer = {'Authorization': 'Bearer ' + token['token']}
        assert client.get('/api/runs', headers=bearer).status_code == 403
        assert client.post('/api/runs', headers=bearer, json={'name': 'No', 'experiment_id': e['id']}).status_code == 403
        assert client.post(f"/api/runs/{r['id']}/metrics", headers=bearer, json={'name': 'val_accuracy', 'value': .4}).status_code == 201


def test_profile_password_and_sessions():
    with TestClient(app) as client, TestClient(app) as second:
        h, _, _ = workspace(client)
        assert client.patch('/api/auth/profile', headers=h, json={'display_name': 'Updated'}).json()['user']['displayName'] == 'Updated'
        second.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD})
        token = post(client, h, '/auth/tokens', name='Token', password=PASSWORD, scopes=['read'])
        assert len(client.get('/api/auth/sessions').json()) == 2
        changed = client.post('/api/auth/password', headers=h, json={'current_password': PASSWORD, 'password': 'new-long-test-password'})
        assert changed.status_code == 200
        assert changed.json()['csrfToken'] != h['X-CSRF-Token']
        assert len(client.get('/api/auth/sessions').json()) == 1
        assert second.get('/api/auth/me').status_code == 401
        assert client.get('/api/projects', headers={'Authorization': 'Bearer ' + token['token']}).status_code == 401
        assert client.get('/api/auth/me').status_code == 200


def test_durable_login_counters():
    with TestClient(app) as client:
        for _ in range(10):
            assert client.post('/api/auth/login', json={'email': 'missing@example.com', 'password': 'wrong'}).status_code == 401
        auth_attempts.clear()
        assert client.post('/api/auth/login', json={'email': 'missing@example.com', 'password': 'wrong'}).status_code == 429


def test_export_import_dry_run_copy_and_invalid_graph():
    with TestClient(app) as client:
        h, p, e = workspace(client)
        r = run(client, h, e, hyperparameters={'lr': .1})
        metric(client, h, r, 'val_accuracy', .7)
        exported = client.get('/api/workspace/export').json()
        assert not {'users', 'sessions', 'api_tokens'} & exported.keys()
        assert 'user_id' not in exported['projects'][0]
        dry = client.post('/api/workspace/import', headers=h, json={'data': exported, 'dry_run': True})
        assert dry.status_code == 200, dry.text
        assert dry.json()['dryRun'] is True
        assert len(client.get('/api/projects').json()) == 1
        copied = client.post('/api/workspace/import', headers=h, json={'data': exported, 'dry_run': False})
        assert copied.status_code == 200, copied.text
        assert len(client.get('/api/projects').json()) == len(client.get('/api/runs').json()) == 2
        invalid = copy.deepcopy(exported)
        invalid['runs'][0]['experiment_id'] = 'missing'
        assert client.post('/api/workspace/import', headers=h, json={'data': invalid, 'dry_run': False}).status_code == 422
        assert len(client.get('/api/projects').json()) == 2


def test_cross_user_details_and_import_references():
    with TestClient(app) as alice, TestClient(app) as bob:
        h, p, e = workspace(alice)
        r = run(alice, h, e)
        account = post(bob, {}, '/auth/register', display_name='Bob', email='bob@example.com', password=PASSWORD)
        bh = {'X-CSRF-Token': account['csrfToken']}
        assert bob.get(f"/api/runs/{r['id']}").status_code == 404
        assert bob.patch(f"/api/projects/{p['id']}", headers=bh, json={'name': 'Hijack'}).status_code == 404
        exported = alice.get('/api/workspace/export').json()
        exported['projects'] = []
        assert bob.post('/api/workspace/import', headers=bh, json={'data': exported, 'dry_run': False}).status_code == 422
        assert bob.get('/api/projects').json() == []


def test_json_bounds_and_parent_cycles():
    with TestClient(app) as client:
        h, _, e = workspace(client)
        assert client.post('/api/runs', headers=h, json={'experiment_id': e['id'], 'name': 'Huge', 'hyperparameters': {'blob': 'x' * 33000}}).status_code == 422
        parent = run(client, h, e, 'Parent')
        child = run(client, h, e, 'Child', parent_run_id=parent['id'])
        assert client.patch(f"/api/runs/{parent['id']}", headers=h, json={'parent_run_id': child['id']}).status_code == 422


def test_import_rejects_timestamp_types_and_parent_cycles():
    with TestClient(app) as client:
        h, _, e = workspace(client)
        a = run(client, h, e, 'A')
        b = run(client, h, e, 'B', parent_run_id=a['id'])
        exported = client.get('/api/workspace/export').json()
        exported['runs'][0]['created_at'] = {'invalid': 'type'}
        assert client.post('/api/workspace/import', headers=h, json={'data': exported}).status_code == 422
        exported = client.get('/api/workspace/export').json()
        runs = {row['id']: row for row in exported['runs']}
        runs[a['id']]['parent_run_id'] = b['id']
        assert client.post('/api/workspace/import', headers=h, json={'data': exported}).status_code == 422


def test_dashboard_queries_are_bounded_and_export_streams(monkeypatch):
    from app.database import Reader
    with TestClient(app) as client:
        workspace(client)
        lengths = []
        original = Reader.query
        def bounded(self, sql, params=()):
            rows = original(self, sql, params)
            lengths.append(len(rows))
            return rows
        monkeypatch.setattr(Reader, 'query', bounded)
        assert client.get('/api/dashboard').status_code == 200
        assert max(lengths) <= 14
        exported = client.get('/api/workspace/export')
        assert exported.headers['content-type'].startswith('application/json')
        assert 'attachment' in exported.headers['content-disposition']
        assert exported.json()['format'] == 'model-lab'


def test_token_issuance_rechecks_revoked_session_after_password_verification(monkeypatch):
    from app import database, main
    with TestClient(app) as client:
        h, _, _ = workspace(client)
        verify = main.verify_password
        def revoked(password, stored):
            result = verify(password, stored)
            database.execute('DELETE FROM sessions')
            return result
        monkeypatch.setattr(main, 'verify_password', revoked)
        result = client.post('/api/auth/tokens', headers=h, json={'name': 'Race', 'password': PASSWORD, 'scopes': ['write']})
        assert result.status_code == 409
        assert database.one('SELECT COUNT(*) AS count FROM api_tokens')['count'] == 0


def test_login_cannot_create_session_after_password_changed_during_verification(monkeypatch):
    from app import database, main
    with TestClient(app) as client:
        workspace(client)
        database.execute('DELETE FROM sessions')
        verify = main.verify_password
        def changed(password, stored):
            result = verify(password, stored)
            database.execute('UPDATE users SET password_hash=?', (main.hash_password('a-new-long-password'),))
            return result
        monkeypatch.setattr(main, 'verify_password', changed)
        result = client.post('/api/auth/login', json={'email': 'owner@example.com', 'password': PASSWORD})
        assert result.status_code == 401
        assert database.one('SELECT COUNT(*) AS count FROM sessions')['count'] == 0


def test_request_logs_are_enabled_and_exclude_credentials_and_query_values():
    import io
    import json
    import logging
    from app.main import logger

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logger.addHandler(handler)
    try:
        with TestClient(app) as client:
            result = client.get('/api/health?private=do-not-log-query', headers={
                'Authorization': 'Bearer do-not-log-token',
                'Cookie': 'ml_session=do-not-log-cookie',
            })
        assert result.status_code == 200
        payload = json.loads(stream.getvalue().strip())
        assert payload['route'] == '/api/health'
        assert payload['status'] == 200
        assert payload['request_id'] == result.headers['X-Request-ID']
        assert 'do-not-log' not in stream.getvalue()
    finally:
        logger.removeHandler(handler)
