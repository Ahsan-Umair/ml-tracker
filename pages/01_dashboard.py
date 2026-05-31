# pages/01_dashboard.py
import streamlit as st
import pandas as pd
from db.queries import (
    get_experiment_dashboard,
    get_accuracy_summary_per_experiment,
    get_storage_per_project,
    get_top_researchers,
)

st.header("Dashboard")

df = get_experiment_dashboard()

# ── Summary metric cards ─────────────────────────────────────
c1, c2, c3, c4 = st.columns(4)
c1.metric("Total Experiments", len(df))
c2.metric("Total Runs", int(df["total_runs"].sum()))
c3.metric("Completed Runs", int(df["completed_runs"].sum()))
best = df["best_accuracy"].max()
c4.metric("Best Accuracy", f"{best:.2%}" if pd.notna(best) else "N/A")

st.divider()

# ── Experiment table ─────────────────────────────────────────
st.subheader("All experiments")
st.dataframe(df, use_container_width=True, hide_index=True)

st.divider()

# ── Accuracy summary chart ───────────────────────────────────
st.subheader("Best accuracy per experiment")
acc_df = get_accuracy_summary_per_experiment()
if not acc_df.empty:
    st.bar_chart(acc_df.set_index("experiment")["best_accuracy"])

st.divider()

# ── Storage per project ──────────────────────────────────────
st.subheader("Dataset storage per project (MB)")
stor_df = get_storage_per_project()
if not stor_df.empty:
    st.bar_chart(stor_df.set_index("project")["total_mb"])

st.divider()

# ── Top researchers ──────────────────────────────────────────
st.subheader("Most active researchers")
st.dataframe(get_top_researchers(), use_container_width=True, hide_index=True)
