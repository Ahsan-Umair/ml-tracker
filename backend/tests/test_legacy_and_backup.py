"""Compatibility and backup integrity at the old/new API boundary."""
import copy

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import SESSION_COOKIE, digest, session_csrf

STAMP = '2026-01-01T00:00:00+00:00'


def seed_original_workspace():
    with database.connection() as conn:
        for statement in database.SCHEMA:
            conn.execute(statement)
        conn.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)')
        conn.execute('INSERT INTO schema_migrations(version) VALUES(1)')
        conn.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', ('owner', 'legacy@example.com', 'Owner', 'unused', STAMP, STAMP))
        conn.execute('INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)', ('project', 'owner', 'Legacy', STAMP, STAMP))
        for name, values in (('fraction', [.95]), ('percent', [95]), ('mixed', [.95, 95])):
            conn.execute('INSERT INTO experiments(id,project_id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                         (name, 'project', 'owner', name, STAMP, STAMP))
            conn.execute('INSERT INTO runs(id,experiment_id,user_id,name,status,started_at,created_at) VALUES(?,?,?,?,?,?,?)',
                         ('run-' + name, name, 'owner', name, 'completed', STAMP, STAMP))
            for step, value in enumerate(values):
                conn.execute('INSERT INTO metrics(id,run_id,user_id,name,value,step,logged_at) VALUES(?,?,?,?,?,?,?)',
                             (f'metric-{name}-{step}', 'run-' + name, 'owner', 'val_accuracy', value, step, STAMP))
        conn.execute('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)',
                     (digest('legacy-token'), 'owner', digest(session_csrf('legacy-token')), '2099-01-01T00:00:00+00:00', STAMP))


def test_original_accuracy_units_are_preserved_and_ambiguous_rankings_require_review():
    seed_original_workspace()
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE, 'legacy-token')
        headers = {'X-CSRF-Token': session_csrf('legacy-token')}
        for name, unit, expected in (('fraction', 'fraction', .95), ('percent', 'percent', 95)):
            experiment = client.get('/api/experiments/' + name).json()
            assert experiment['metric_unit'] == unit
            assert experiment['metric_policy_confirmed'] is True
            row = client.get('/api/runs/run-' + name).json()
            assert row['score'] == expected
            assert client.get('/api/leaderboard?experiment_id=' + name).json()[0]['score'] == expected
        mixed = client.get('/api/experiments/mixed').json()
        assert mixed['metric_policy_confirmed'] is False
        assert client.get('/api/runs/run-mixed').json()['score'] is None
        assert client.get('/api/leaderboard?experiment_id=mixed').json() == []
        dashboard = client.get('/api/dashboard?experiment_id=mixed').json()
        assert dashboard['selectedMetric']['confirmed'] is False
        assert dashboard['stats']['best_score'] is None
        assert dashboard['trend'] == []
        metrics = client.get('/api/runs/run-mixed/metrics').json()
        assert [(row['value'], row['unit']) for row in metrics] == [(.95, 'fraction'), (95, 'percent')]
        exported = client.get('/api/workspace/export').json()
        assert client.post('/api/workspace/import', headers=headers, json={'data': exported, 'dry_run': True}).status_code == 200
        assert client.post('/api/workspace/import', headers=headers, json={'data': exported, 'dry_run': False}).status_code == 200
        client.patch('/api/experiments/mixed', headers=headers, json={'description': 'Reviewed later'})
        assert client.get('/api/runs/run-mixed').json()['score'] is None
        confirmed = client.patch('/api/experiments/mixed', headers=headers, json={'metric_unit': 'percent', 'metric_policy_confirmed': True})
        assert confirmed.status_code == 200
        assert client.get('/api/runs/run-mixed').json()['score'] == 95


def fresh_workspace(client):
    account = client.post('/api/auth/register', json={'email': 'owner@example.com', 'display_name': 'Owner', 'password': 'a-long-test-password'}).json()
    headers = {'X-CSRF-Token': account['csrfToken']}
    project = client.post('/api/projects', headers=headers, json={'name': 'Backup'}).json()
    experiment = client.post('/api/experiments', headers=headers, json={'name': 'Evaluation', 'project_id': project['id']}).json()
    run = client.post('/api/runs', headers=headers, json={'name': 'First', 'experiment_id': experiment['id']}).json()
    return account['user']['id'], headers, project, experiment, run


def test_import_preview_rejects_duplicate_versions_and_untyped_relationship_ids():
    with TestClient(app) as client:
        _, headers, project, _, run = fresh_workspace(client)
        model = client.post('/api/models', headers=headers, json={'name': 'Model', 'project_id': project['id']}).json()
        client.post('/api/models/' + model['id'] + '/versions', headers=headers, json={'version': 'v1'})
        client.post('/api/runs/' + run['id'] + '/metrics', headers=headers, json={'name': 'val_accuracy', 'value': .9})
        exported = client.get('/api/workspace/export').json()
        invalid = copy.deepcopy(exported)
        duplicate = {**invalid['model_versions'][0], 'id': 'another-version-id'}
        invalid['model_versions'].append(duplicate)
        assert client.post('/api/workspace/import', headers=headers, json={'data': invalid}).status_code == 422
        for table, field in (('model_versions', 'model_id'), ('metrics', 'run_id')):
            invalid = copy.deepcopy(exported)
            invalid[table][0][field] = {'not': 'an identifier'}
            assert client.post('/api/workspace/import', headers=headers, json={'data': invalid}).status_code == 422


def test_export_uses_one_snapshot_while_training_logs_new_records(monkeypatch):
    with TestClient(app) as client:
        user_id, headers, _, experiment, run = fresh_workspace(client)
        client.post('/api/runs/' + run['id'] + '/metrics', headers=headers, json={'name': 'val_accuracy', 'value': .9})
        database.execute('PRAGMA journal_mode=WAL')
        original = database.Reader.query
        written = []

        def concurrent_write(reader, sql, params=()):
            rows = original(reader, sql, params)
            if sql.startswith('SELECT r.* FROM runs') and not written:
                written.append(True)
                with database.connection() as writer:
                    writer.execute('INSERT INTO runs(id,experiment_id,user_id,name,status,started_at,created_at) VALUES(?,?,?,?,?,?,?)',
                                   ('concurrent-run', experiment['id'], user_id, 'New attempt', 'running', STAMP, STAMP))
                    writer.execute('INSERT INTO metrics(id,run_id,user_id,name,value,step,logged_at,unit,split) VALUES(?,?,?,?,?,?,?,?,?)',
                                   ('concurrent-metric', 'concurrent-run', user_id, 'val_accuracy', .8, 1, STAMP, 'fraction', 'validation'))
            return rows

        monkeypatch.setattr(database.Reader, 'query', concurrent_write)
        exported = client.get('/api/workspace/export').json()
        assert written
        assert len(exported['runs']) == len(exported['metrics']) == 1
        assert database.one('SELECT COUNT(*) AS count FROM runs')['count'] == 2
        assert client.post('/api/workspace/import', headers=headers, json={'data': exported, 'dry_run': True}).status_code == 200
