# pages/04_runs.py
# This is the most important page — it's where users log experiment runs.
# No real ML model is needed. The user fills in the results manually.
import json
import streamlit as st
from db.queries import (
    get_projects_for_user,
    get_experiments_for_project,
    get_runs_for_experiment,
    log_run,
    complete_run,
    fail_run,
    log_metric,
)

st.header("Runs")
user = st.session_state.get("user")
if not user:
    st.warning("Please login first.")
    st.stop()

# ── Select project → experiment ──────────────────────────────
projects = get_projects_for_user(user["user_id"])
if projects.empty:
    st.info("No projects yet. Create one in the Projects page.")
    st.stop()

proj_names = projects["name"].tolist()
proj_pick  = st.selectbox("Project", proj_names)
proj_id    = int(projects.loc[projects["name"] == proj_pick, "project_id"].iloc[0])

exps = get_experiments_for_project(proj_id)
if exps.empty:
    st.info("No experiments in this project yet.")
    st.stop()

exp_names = exps["name"].tolist()
exp_pick  = st.selectbox("Experiment", exp_names)
exp_id    = int(exps.loc[exps["name"] == exp_pick, "experiment_id"].iloc[0])

st.divider()

# ── Existing runs ────────────────────────────────────────────
st.subheader("Existing runs")
runs_df = get_runs_for_experiment(exp_id)
if not runs_df.empty:
    st.dataframe(runs_df[["run_id","model_name","run_type","status",
                           "epochs","learning_rate","duration"]],
                 use_container_width=True, hide_index=True)

    # Quick action buttons
    col_a, col_b = st.columns(2)
    with col_a:
        rid_complete = st.number_input("Mark run ID as COMPLETED", min_value=1, step=1)
        if st.button("Mark completed"):
            complete_run(int(rid_complete))
            # The trigger in MySQL auto-updates the experiment status
            st.success(f"Run {rid_complete} marked completed. "
                       "Trigger may have updated the experiment status too.")
            st.rerun()
    with col_b:
        rid_fail = st.number_input("Mark run ID as FAILED", min_value=1, step=1)
        if st.button("Mark failed"):
            fail_run(int(rid_fail))
            st.warning(f"Run {rid_fail} marked failed.")
            st.rerun()
else:
    st.info("No runs yet for this experiment.")

st.divider()

# ── Log a new run ─────────────────────────────────────────────
# THIS IS THE KEY FORM. No real ML training happens here.
# The user simply types in the model name and whatever results
# they got (or want to simulate). The form writes to MySQL.
st.subheader("Log a new run")
st.caption("Fill in the details of a model run. You type the results manually "
           "— no actual model training happens in this app.")

with st.form("log_run_form"):
    model_name = st.text_input("Model name", placeholder="e.g. ResNet-18, BERT-base, custom-CNN")
    run_type   = st.selectbox("Run type", ["training", "evaluation"])

    st.markdown("**Hyperparameters** — add as many as you want")
    hparam_raw = st.text_area(
        "Hyperparameters (JSON format)",
        value='{"batch_size": 32, "optimizer": "adam"}',
        help='Write as valid JSON, e.g. {"batch_size": 32, "lr": 0.001}'
    )

    col1, col2 = st.columns(2)
    with col1:
        epochs = st.number_input("Epochs (training only)", min_value=0, value=50)
        lr     = st.number_input("Learning rate", min_value=0.0, value=0.001,
                                  format="%.5f")
    with col2:
        test_split    = st.number_input("Test split (evaluation only)", 0.0, 1.0, 0.2)
        baseline_model = st.text_input("Baseline model (evaluation only)")

    submitted = st.form_submit_button("Save run")

if submitted:
    try:
        hparams = json.loads(hparam_raw)
    except json.JSONDecodeError:
        st.error("Hyperparameters must be valid JSON. "
                 'Example: {"batch_size": 32, "lr": 0.001}')
        st.stop()

    run_id = log_run(
        experiment_id=exp_id,
        model_name=model_name,
        run_type=run_type,
        hyperparameters=hparams,
        epochs=epochs if epochs > 0 else None,
        learning_rate=lr if lr > 0 else None,
        test_split=test_split if run_type == "evaluation" else None,
        baseline_model=baseline_model or None,
    )
    st.success(f"Run saved! run_id = {run_id}")
    st.info("Now go to the Metrics page to log accuracy/loss for this run.")

st.divider()

# ── Quick metric logger ───────────────────────────────────────
st.subheader("Log a metric for an existing run")
st.caption("After saving a run, use this to record accuracy, loss, or any metric.")

with st.form("log_metric_form"):
    target_run_id  = st.number_input("Run ID", min_value=1, step=1)
    metric_name    = st.selectbox("Metric",
                                  ["train_acc","val_acc","test_acc",
                                   "train_loss","val_loss","reward","epsilon"])
    metric_value   = st.number_input("Value", format="%.6f")
    metric_epoch   = st.number_input("Epoch (leave 0 if not epoch-based)",
                                     min_value=0, step=1)
    log_btn = st.form_submit_button("Log metric")

if log_btn:
    log_metric(
        run_id=int(target_run_id),
        metric_name=metric_name,
        value=metric_value,
        epoch=int(metric_epoch) if metric_epoch > 0 else None,
    )
    st.success(f"{metric_name} = {metric_value} logged for run {target_run_id}.")
