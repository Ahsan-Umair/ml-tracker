# pages/07_analytics.py
import streamlit as st

st.set_page_config(page_title="Analytics", page_icon="🔍", layout="wide")

if not st.session_state.get("user"):
    st.warning("Please login first.")
    st.stop()

from db.queries import (
    get_full_chain,
    get_users_with_completed_experiments,
    get_large_datasets,
    get_storage_per_project,
    get_experiments_with_tags,
    get_all_tags,
    get_researchers,
)

st.title("🔍 Analytics")
st.caption("Advanced SQL queries — JOINs, subqueries, aggregations, and more.")
st.divider()

# ── Q4: Full chain ────────────────────────────────────────────
st.subheader("Full chain: User → Project → Dataset → Experiment")
st.caption("4-table JOIN — Q4 from the SQL file")
chain = get_full_chain()
if not chain.empty:
    st.dataframe(chain, use_container_width=True, hide_index=True)
else:
    st.info("No data yet.")

st.divider()

# ── Q14: Subquery ─────────────────────────────────────────────
st.subheader("Users with at least one completed experiment")
st.caption("IN subquery — Q14 from the SQL file")
users_comp = get_users_with_completed_experiments()
if not users_comp.empty:
    st.dataframe(users_comp, use_container_width=True, hide_index=True)
else:
    st.info("No users with completed experiments yet.")

st.divider()

# ── Q3: Large datasets ────────────────────────────────────────
st.subheader("Large datasets (above threshold)")
st.caption("Filtered query — Q3 from the SQL file")
min_mb = st.slider("Minimum size (MB)", 1, 500, 10)
large = get_large_datasets(float(min_mb))
if not large.empty:
    st.dataframe(large, use_container_width=True, hide_index=True)
    st.bar_chart(large.set_index("name")["size_mb"])
else:
    st.info(f"No datasets larger than {min_mb} MB.")

st.divider()

# ── Q12: Storage per project ──────────────────────────────────
st.subheader("Storage usage per project")
st.caption("SUM + GROUP BY — Q12 from the SQL file")
stor = get_storage_per_project()
if not stor.empty:
    col1, col2 = st.columns([1, 2])
    col1.dataframe(stor, use_container_width=True, hide_index=True)
    col2.bar_chart(stor.set_index("project")["total_mb"])
else:
    st.info("No dataset storage data yet.")

st.divider()

# ── Q7: Tags ──────────────────────────────────────────────────
st.subheader("Experiments with their tags")
st.caption("GROUP_CONCAT — Q7 from the SQL file")
tagged = get_experiments_with_tags()
if not tagged.empty:
    st.dataframe(tagged, use_container_width=True, hide_index=True)
else:
    st.info("No tags assigned yet.")

st.divider()

# ── Q18: Tag usage ────────────────────────────────────────────
st.subheader("Tag usage counts")
st.caption("COUNT + GROUP BY — Q18 from the SQL file")
tags = get_all_tags()
if not tags.empty:
    st.dataframe(tags, use_container_width=True, hide_index=True)
    if tags["usage_count"].sum() > 0:
        st.bar_chart(tags.set_index("name")["usage_count"])

st.divider()

# ── Q1: Researchers ───────────────────────────────────────────
st.subheader("All researchers")
st.caption("Basic filter — Q1 from the SQL file")
res = get_researchers()
if not res.empty:
    st.dataframe(res, use_container_width=True, hide_index=True)
else:
    st.info("No researchers registered yet.")
