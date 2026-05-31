# pages/02_projects.py
import streamlit as st

st.set_page_config(page_title="Projects", page_icon="📁", layout="wide")

if not st.session_state.get("user"):
    st.warning("Please login first.")
    st.stop()

from db.queries import (
    get_projects_for_user,
    create_project,
    delete_project,
    get_all_projects,
)

user = st.session_state.user
st.title("📁 Projects")
st.divider()

# ── Create new project ────────────────────────────────────────
with st.expander("➕ Create new project", expanded=False):
    with st.form("new_project"):
        pname = st.text_input("Project name", placeholder="e.g. Image Classifier")
        pdesc = st.text_area("Description", placeholder="What is this project about?")
        if st.form_submit_button("Create project", use_container_width=True):
            if not pname.strip():
                st.error("Project name is required.")
            else:
                pid = create_project(user["user_id"], pname.strip(), pdesc.strip())
                st.success(f"Project created! ID = {pid}")
                st.rerun()

st.divider()

# ── My projects ───────────────────────────────────────────────
st.subheader(f"My projects  ({user['username']})")
my_projects = get_projects_for_user(user["user_id"])

if my_projects.empty:
    st.info("You have no projects yet. Create one above.")
else:
    for _, row in my_projects.iterrows():
        with st.container(border=True):
            col1, col2, col3, col4 = st.columns([3, 1, 1, 1])
            col1.markdown(f"**{row['name']}**")
            col1.caption(row["description"] or "No description")
            col2.metric("Experiments", int(row["experiments"]))
            col3.metric("Datasets",    int(row["datasets"]))
            col4.caption(str(row["created_at"])[:10])

            if st.button(f"🗑 Delete '{row['name']}'",
                         key=f"del_{row['project_id']}",
                         type="secondary"):
                delete_project(int(row["project_id"]))
                st.warning(f"Project '{row['name']}' deleted.")
                st.rerun()

# ── Admin: all projects ───────────────────────────────────────
if user["role"] == "admin":
    st.divider()
    st.subheader("All projects (admin view)")
    all_p = get_all_projects()
    if not all_p.empty:
        st.dataframe(all_p, use_container_width=True, hide_index=True)
