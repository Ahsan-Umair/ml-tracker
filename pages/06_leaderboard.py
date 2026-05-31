# pages/06_leaderboard.py
import streamlit as st
import pandas as pd

st.set_page_config(page_title="Leaderboard", page_icon="🏆", layout="wide")

if not st.session_state.get("user"):
    st.warning("Please login first.")
    st.stop()

from db.queries import (
    get_best_model_per_experiment,
    get_avg_run_duration,
    get_top_researchers,
    get_completed_experiments,
)

st.title("🏆 Leaderboard")
st.caption("Runs ranked by best accuracy within each experiment. Uses RANK() OVER (PARTITION BY experiment) SQL window function.")
st.divider()

st.subheader("Best accuracy per run — ranked within each experiment")

df = get_best_model_per_experiment()

if df.empty:
    st.info("No runs with accuracy metrics found yet.")
else:
    df["best_accuracy"]      = (df["best_accuracy"] * 100).round(2).astype(str) + "%"
    df["rank_in_experiment"] = df["rank_in_experiment"].astype(int)
    df = df.sort_values(["experiment", "rank_in_experiment"])

    html = "<table style='width:100%;border-collapse:collapse;font-size:14px;font-family:sans-serif;'>"
    html += "<thead><tr style='background-color:#333;color:#fff;'>"
    html += "<th style='padding:10px 14px;text-align:left;border-bottom:2px solid #555;'>Experiment</th>"
    html += "<th style='padding:10px 14px;text-align:left;border-bottom:2px solid #555;'>Model</th>"
    html += "<th style='padding:10px 14px;text-align:left;border-bottom:2px solid #555;'>Best Accuracy</th>"
    html += "<th style='padding:10px 14px;text-align:center;border-bottom:2px solid #555;'>Rank</th>"
    html += "</tr></thead><tbody>"

    for _, row in df.iterrows():
        rank = int(row["rank_in_experiment"])
        if rank == 1:
            bg, color, weight, badge = "#1a7a4a", "#ffffff", "bold", "🥇"
        elif rank == 2:
            bg, color, weight, badge = "#1a4a7a", "#ffffff", "normal", "🥈"
        elif rank == 3:
            bg, color, weight, badge = "#7a4a1a", "#ffffff", "normal", "🥉"
        else:
            bg, color, weight, badge = "#2a2a2a", "#dddddd", "normal", ""

        html += f"<tr style='background-color:{bg};color:{color};font-weight:{weight};'>"
        html += f"<td style='padding:10px 14px;border-bottom:1px solid #444;'>{row['experiment']}</td>"
        html += f"<td style='padding:10px 14px;border-bottom:1px solid #444;'>{row['model_name']}</td>"
        html += f"<td style='padding:10px 14px;border-bottom:1px solid #444;'>{row['best_accuracy']}</td>"
        html += f"<td style='padding:10px 14px;border-bottom:1px solid #444;text-align:center;'>{badge} {rank}</td>"
        html += "</tr>"

    html += "</tbody></table>"

    st.markdown(html, unsafe_allow_html=True)
    st.markdown("🥇 Green = Rank 1 &nbsp;&nbsp; 🥈 Blue = Rank 2 &nbsp;&nbsp; 🥉 Brown = Rank 3")

st.divider()

st.subheader("Average run duration per model")
dur_df = get_avg_run_duration()
if not dur_df.empty:
    col1, col2 = st.columns([2, 1])
    with col1:
        st.bar_chart(dur_df.set_index("model_name")["avg_min"])
    with col2:
        st.dataframe(dur_df, use_container_width=True, hide_index=True)
else:
    st.info("No completed runs with timing data yet.")

st.divider()

st.subheader("Top researchers by total runs")
researchers = get_top_researchers()
if not researchers.empty:
    st.dataframe(researchers, use_container_width=True, hide_index=True)
else:
    st.info("No researcher activity logged yet.")

st.divider()

st.subheader("All completed experiments")
comp = get_completed_experiments()
if not comp.empty:
    st.dataframe(comp, use_container_width=True, hide_index=True)
else:
    st.info("No completed experiments yet.")