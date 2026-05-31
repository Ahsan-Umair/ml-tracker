# db/queries.py
import json
import pandas as pd
from sqlalchemy import text
from db.connection import engine


# ══════════════════════════════════════════════
#  USERS
# ══════════════════════════════════════════════

def login_user(username, password_raw):
    sql = text("""
        SELECT user_id, username, role
        FROM users
        WHERE username = :u AND password_hash = SHA2(:p, 256)
    """)
    with engine.connect() as conn:
        row = conn.execute(sql, {"u": username, "p": password_raw}).fetchone()
    return dict(row._mapping) if row else None


def register_user(username, email, password_raw, role, institution=None, expertise=None):
    sql = text("""
        INSERT INTO users (username, email, password_hash, role, institution, expertise,
                           can_delete, manage_users)
        VALUES (:u, :e, SHA2(:p, 256), :r, :inst, :exp, :cd, :mu)
    """)
    try:
        with engine.begin() as conn:
            conn.execute(sql, {
                "u": username, "e": email, "p": password_raw, "r": role,
                "inst": institution, "exp": expertise,
                "cd": role == "admin", "mu": role == "admin",
            })
        return True
    except Exception:
        return False


def get_all_users():
    with engine.connect() as conn:
        return pd.read_sql(
            "SELECT user_id, username, email, role, institution, expertise, created_at FROM users ORDER BY created_at DESC",
            conn,
        )


def get_researchers():
    with engine.connect() as conn:
        return pd.read_sql(
            "SELECT username, email, institution, expertise FROM users WHERE role='researcher' ORDER BY username",
            conn,
        )


def get_top_researchers():
    sql = """
        SELECT u.username,
               COUNT(r.run_id)                 AS total_runs,
               COUNT(DISTINCT e.experiment_id) AS total_experiments
        FROM users u
        JOIN projects p    ON u.user_id      = p.user_id
        JOIN experiments e ON p.project_id   = e.project_id
        JOIN runs r        ON e.experiment_id = r.experiment_id
        WHERE u.role = 'researcher'
        GROUP BY u.user_id, u.username
        ORDER BY total_runs DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


# ══════════════════════════════════════════════
#  PROJECTS
# ══════════════════════════════════════════════

def get_projects_for_user(user_id):
    sql = text("""
        SELECT p.project_id, p.name, p.description, p.created_at,
               COUNT(DISTINCT e.experiment_id) AS experiments,
               COUNT(DISTINCT d.dataset_id)    AS datasets
        FROM projects p
        LEFT JOIN experiments e ON p.project_id = e.project_id
        LEFT JOIN datasets    d ON p.project_id = d.project_id
        WHERE p.user_id = :uid
        GROUP BY p.project_id, p.name, p.description, p.created_at
        ORDER BY p.created_at DESC
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"uid": user_id})


def get_all_projects():
    sql = """
        SELECT p.project_id, p.name, u.username AS owner, p.created_at
        FROM projects p JOIN users u ON p.user_id = u.user_id
        ORDER BY p.created_at DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def create_project(user_id, name, description):
    sql = text("INSERT INTO projects (user_id, name, description) VALUES (:uid, :n, :d)")
    with engine.begin() as conn:
        result = conn.execute(sql, {"uid": user_id, "n": name, "d": description})
        return result.lastrowid


def delete_project(project_id):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM projects WHERE project_id = :pid"), {"pid": project_id})


# ══════════════════════════════════════════════
#  DATASETS
# ══════════════════════════════════════════════

def get_datasets_for_project(project_id):
    sql = text("""
        SELECT dataset_id, name, format,
               ROUND(size_bytes/1048576, 2) AS size_mb,
               description, uploaded_at
        FROM datasets WHERE project_id = :pid ORDER BY uploaded_at DESC
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"pid": project_id})


def get_all_datasets():
    sql = """
        SELECT d.dataset_id, d.name, p.name AS project, d.format,
               ROUND(d.size_bytes/1048576,2) AS size_mb, d.uploaded_at
        FROM datasets d JOIN projects p ON d.project_id = p.project_id
        ORDER BY d.uploaded_at DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def add_dataset(project_id, name, file_path, size_bytes, fmt, description):
    sql = text("""
        INSERT INTO datasets (project_id, name, file_path, size_bytes, format, description)
        VALUES (:pid, :n, :fp, :s, :f, :d)
    """)
    with engine.begin() as conn:
        result = conn.execute(sql, {
            "pid": project_id, "n": name, "fp": file_path,
            "s": size_bytes, "f": fmt, "d": description,
        })
        return result.lastrowid


def get_large_datasets(min_mb=10.0):
    sql = text("""
        SELECT d.name, p.name AS project, d.format,
               ROUND(d.size_bytes/1048576,2) AS size_mb
        FROM datasets d JOIN projects p ON d.project_id = p.project_id
        WHERE d.size_bytes > :mb ORDER BY d.size_bytes DESC
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"mb": int(min_mb * 1048576)})


def get_storage_per_project():
    sql = """
        SELECT p.name AS project,
               COUNT(d.dataset_id)                 AS total_datasets,
               ROUND(SUM(d.size_bytes)/1048576, 2) AS total_mb
        FROM projects p JOIN datasets d ON p.project_id = d.project_id
        GROUP BY p.project_id, p.name ORDER BY total_mb DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


# ══════════════════════════════════════════════
#  EXPERIMENTS
# ══════════════════════════════════════════════

def get_experiment_dashboard():
    with engine.connect() as conn:
        return pd.read_sql(
            "SELECT * FROM experiment_dashboard ORDER BY username, project",
            conn,
        )


def get_experiments_for_project(project_id):
    sql = text("""
        SELECT e.experiment_id, e.name, e.status,
               d.name AS dataset, e.created_at
        FROM experiments e
        JOIN datasets d ON e.dataset_id = d.dataset_id
        WHERE e.project_id = :pid ORDER BY e.created_at DESC
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"pid": project_id})


def get_all_experiments():
    sql = """
        SELECT e.experiment_id, e.name, e.status,
               p.name AS project, d.name AS dataset, e.created_at
        FROM experiments e
        JOIN projects p ON e.project_id = p.project_id
        JOIN datasets d ON e.dataset_id = d.dataset_id
        ORDER BY e.created_at DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def get_completed_experiments():
    sql = """
        SELECT e.experiment_id, e.name AS experiment,
               p.name AS project, e.status
        FROM experiments e
        JOIN projects p ON e.project_id = p.project_id
        WHERE e.status = 'completed' ORDER BY e.created_at DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def create_experiment(project_id, dataset_id, name, description):
    sql = text("""
        INSERT INTO experiments (project_id, dataset_id, name, description, status)
        VALUES (:pid, :did, :n, :d, 'draft')
    """)
    with engine.begin() as conn:
        result = conn.execute(sql, {
            "pid": project_id, "did": dataset_id, "n": name, "d": description,
        })
        return result.lastrowid


def update_experiment_status(experiment_id, status):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE experiments SET status=:s WHERE experiment_id=:eid"),
            {"s": status, "eid": experiment_id},
        )


def get_experiments_with_tags():
    sql = """
        SELECT e.name AS experiment,
               GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ') AS tags
        FROM experiments e
        JOIN experiment_tags et ON e.experiment_id = et.experiment_id
        JOIN tags t ON et.tag_id = t.tag_id
        GROUP BY e.experiment_id, e.name
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def get_experiments_with_run_counts():
    sql = """
        SELECT e.name AS experiment, p.name AS project,
               COUNT(r.run_id)           AS total_runs,
               SUM(r.status='completed') AS completed_runs
        FROM experiments e
        JOIN projects p ON e.project_id = p.project_id
        LEFT JOIN runs r ON e.experiment_id = r.experiment_id
        GROUP BY e.experiment_id, e.name, p.name
        ORDER BY total_runs DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def call_experiment_summary(experiment_id):
    with engine.connect() as conn:
        result = conn.execute(
            text("CALL GetExperimentSummary(:eid)"), {"eid": experiment_id}
        )
        return pd.DataFrame(result.fetchall(), columns=result.keys())


def get_full_chain():
    sql = """
        SELECT u.username, p.name AS project,
               d.name AS dataset, e.name AS experiment, e.status
        FROM users u
        JOIN projects p    ON u.user_id      = p.user_id
        JOIN experiments e ON p.project_id   = e.project_id
        JOIN datasets d    ON d.dataset_id   = e.dataset_id
        ORDER BY u.username, p.name
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def get_users_with_completed_experiments():
    sql = """
        SELECT DISTINCT u.username, u.email, u.role
        FROM users u
        WHERE u.user_id IN (
            SELECT p.user_id FROM projects p
            JOIN experiments e ON p.project_id = e.project_id
            WHERE e.status = 'completed'
        )
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


# ══════════════════════════════════════════════
#  RUNS
# ══════════════════════════════════════════════

def get_runs_for_experiment(experiment_id):
    sql = text("""
        SELECT run_id, model_name, run_type, status,
               epochs, learning_rate, test_split, baseline_model,
               hyperparameters, started_at, ended_at,
               TIMEDIFF(ended_at, started_at) AS duration
        FROM runs WHERE experiment_id = :eid ORDER BY started_at DESC
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"eid": experiment_id})


def get_all_runs():
    sql = """
        SELECT r.run_id, r.model_name, r.run_type, r.status,
               e.name AS experiment, r.epochs, r.learning_rate, r.started_at
        FROM runs r JOIN experiments e ON r.experiment_id = e.experiment_id
        ORDER BY r.started_at DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def log_run(experiment_id, model_name, run_type, hyperparameters,
            epochs=None, learning_rate=None,
            test_split=None, baseline_model=None):
    sql = text("""
        INSERT INTO runs
            (experiment_id, model_name, run_type, hyperparameters,
             status, started_at, epochs, learning_rate,
             test_split, baseline_model)
        VALUES
            (:eid, :mn, :rt, :hp, 'running', NOW(),
             :ep, :lr, :ts, :bm)
    """)
    with engine.begin() as conn:
        result = conn.execute(sql, {
            "eid": experiment_id, "mn": model_name, "rt": run_type,
            "hp": json.dumps(hyperparameters),
            "ep": epochs, "lr": learning_rate,
            "ts": test_split, "bm": baseline_model,
        })
        return result.lastrowid


def complete_run(run_id):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE runs SET status='completed', ended_at=NOW() WHERE run_id=:rid"),
            {"rid": run_id},
        )


def fail_run(run_id):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE runs SET status='failed', ended_at=NOW() WHERE run_id=:rid"),
            {"rid": run_id},
        )


def get_best_model_per_experiment():
    sql = """
        SELECT e.name AS experiment, r.model_name,
               ROUND(MAX(m.value), 4) AS best_accuracy,
               RANK() OVER (
                   PARTITION BY e.experiment_id
                   ORDER BY MAX(m.value) DESC
               ) AS rank_in_experiment
        FROM experiments e
        JOIN runs r    ON e.experiment_id = r.experiment_id
        JOIN metrics m ON r.run_id        = m.run_id
        WHERE m.metric_name IN ('train_acc','test_acc','val_acc')
        GROUP BY e.experiment_id, e.name, r.run_id, r.model_name
        ORDER BY e.name, rank_in_experiment
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def get_avg_run_duration():
    sql = """
        SELECT model_name, COUNT(*) AS completed_runs,
               ROUND(AVG(TIMESTAMPDIFF(MINUTE, started_at, ended_at)), 1) AS avg_min
        FROM runs
        WHERE status='completed'
          AND started_at IS NOT NULL AND ended_at IS NOT NULL
        GROUP BY model_name ORDER BY avg_min DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


# ══════════════════════════════════════════════
#  METRICS
# ══════════════════════════════════════════════

def get_metrics_for_run(run_id):
    sql = text("""
        SELECT epoch, metric_name, value, logged_at
        FROM metrics WHERE run_id = :rid
        ORDER BY metric_name, epoch
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"rid": run_id})


def log_metric(run_id, metric_name, value, epoch=None):
    sql = text("""
        INSERT INTO metrics (run_id, metric_name, value, epoch)
        VALUES (:rid, :mn, :v, :ep)
    """)
    with engine.begin() as conn:
        conn.execute(sql, {"rid": run_id, "mn": metric_name, "v": value, "ep": epoch})


def log_metrics_bulk(run_id, rows):
    sql = text("""
        INSERT INTO metrics (run_id, metric_name, value, epoch)
        VALUES (:rid, :mn, :v, :ep)
    """)
    with engine.begin() as conn:
        conn.execute(sql, [
            {"rid": run_id, "mn": r["metric_name"],
             "v": r["value"], "ep": r.get("epoch")}
            for r in rows
        ])


def get_loss_curve(run_id):
    sql = text("""
        SELECT epoch, ROUND(value,4) AS loss
        FROM metrics
        WHERE run_id=:rid AND metric_name='train_loss'
        ORDER BY epoch
    """)
    with engine.connect() as conn:
        return pd.read_sql(sql, conn, params={"rid": run_id})


def get_accuracy_summary_per_experiment():
    sql = """
        SELECT e.name AS experiment,
               ROUND(AVG(m.value),4) AS avg_accuracy,
               ROUND(MAX(m.value),4) AS best_accuracy,
               ROUND(MIN(m.value),4) AS worst_accuracy
        FROM metrics m
        JOIN runs r        ON m.run_id        = r.run_id
        JOIN experiments e ON r.experiment_id = e.experiment_id
        WHERE m.metric_name = 'train_acc'
        GROUP BY e.experiment_id, e.name
        ORDER BY best_accuracy DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


# ══════════════════════════════════════════════
#  TAGS
# ══════════════════════════════════════════════

def get_all_tags():
    sql = """
        SELECT t.tag_id, t.name, t.color,
               COUNT(et.experiment_id) AS usage_count
        FROM tags t
        LEFT JOIN experiment_tags et ON t.tag_id = et.tag_id
        GROUP BY t.tag_id, t.name, t.color
        ORDER BY usage_count DESC
    """
    with engine.connect() as conn:
        return pd.read_sql(sql, conn)


def create_tag(name, color="#7F77DD"):
    sql = text("INSERT INTO tags (name, color) VALUES (:n, :c)")
    with engine.begin() as conn:
        result = conn.execute(sql, {"n": name, "c": color})
        return result.lastrowid


def add_tag_to_experiment(experiment_id, tag_id):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT IGNORE INTO experiment_tags (experiment_id, tag_id) VALUES (:eid, :tid)"),
            {"eid": experiment_id, "tid": tag_id},
        )