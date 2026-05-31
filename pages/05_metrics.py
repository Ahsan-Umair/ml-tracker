# pages/05_metrics.py
import streamlit as st
import pandas as pd
from db.queries import get_metrics_for_run, get_loss_curve

st.header("Metrics & Training Curves")

run_id = st.number_input("Enter Run ID to visualise", min_value=1, step=1, value=1)

if st.button("Load metrics"):
    df = get_metrics_for_run(int(run_id))

    if df.empty:
        st.warning("No metrics found for this run ID.")
    else:
        st.success(f"Loaded {len(df)} metric readings for run {run_id}.")

        # Separate out each metric into its own chart
        for metric in df["metric_name"].unique():
            subset = df[df["metric_name"] == metric].copy()
            subset = subset.dropna(subset=["epoch"])

            if subset.empty:
                # Final-only metric (no epoch) — just show as a number
                val = df[df["metric_name"] == metric]["value"].iloc[0]
                st.metric(label=metric, value=f"{val:.4f}")
            else:
                st.subheader(metric)
                chart_df = subset.set_index("epoch")[["value"]]
                chart_df.columns = [metric]
                st.line_chart(chart_df)

        st.divider()
        st.subheader("Raw data")
        st.dataframe(df, use_container_width=True, hide_index=True)
