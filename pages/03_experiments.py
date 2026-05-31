# pages/03_experiments.py
import streamlit as st

st.set_page_config(page_title="Experiments", page_icon="🔬", layout="wide")

if not st.session_state.get("user"):
    st.warning("Please login first.")
    st.stop()

from db.queries import (
    get_projects_for_user,
    get_datasets_for_project,
    get_experiments_for_project,
    create_experiment,
    update_experiment_status,
    get_experiments_with_tags,
    get_all_tags,
    add_tag_to_experiment,
    create_tag,
    call_experiment_summary,
    add_dataset,
)

user = st.session_state.user
st.title("🔬 Experiments")
st.divider()

# ── Select project ────────────────────────────────────────────
projects = get_projects_for_user(user["user_id"])
if projects.empty:
    st.warning("No projects found. Go to Projects page and create one first.")
    st.stop()

proj_names = projects["name"].tolist()
selected_proj = st.selectbox("Select project", proj_names)
proj_id = int(projects.loc[projects["name"] == selected_proj, "project_id"].iloc[0])

st.divider()

# ── Add dataset to project (needed before creating experiment) ─
with st.expander("➕ Add dataset to this project"):
    with st.form("add_dataset"):
        ds_name  = st.text_input("Dataset name", placeholder="e.g. CIFAR-10 Train")
        ds_path  = st.text_input("File path / URL", placeholder="e.g. /data/cifar10.csv")
        ds_size  = st.number_input("File size (bytes)", min_value=0, value=1000000)
        ds_fmt   = st.selectbox("Format", ["csv","json","npz","pkl","txt","xlsx","other"])
        ds_desc  = st.text_area("Description")
        if st.form_submit_button("Add dataset"):
            if not ds_name.strip():
                st.error("Dataset name required.")
            else:
                did = add_dataset(proj_id, ds_name.strip(), ds_path.strip(),
                                  int(ds_size), ds_fmt, ds_desc.strip())
                st.success(f"Dataset added! ID = {did}")
                st.rerun()

# ── Create experiment ─────────────────────────────────────────
with st.expander("➕ Create new experiment"):
    datasets = get_datasets_for_project(proj_id)
    if datasets.empty:
        st.warning("Add a dataset to this project first (see above).")
    else:
        with st.form("new_exp"):
            exp_name = st.text_input("Experiment name", placeholder="e.g. ResNet-18 Baseline")
            exp_desc = st.text_area("Description")
            ds_pick  = st.selectbox("Dataset to use", datasets["name"].tolist())
            ds_id    = int(datasets.loc[datasets["name"] == ds_pick, "dataset_id"].iloc[0])
            if st.form_submit_button("Create experiment"):
                if not exp_name.strip():
                    st.error("Experiment name required.")
                else:
                    eid = create_experiment(proj_id, ds_id, exp_name.strip(), exp_desc.strip())
                    st.success(f"Experiment created! ID = {eid}")
                    st.rerun()

st.divider()

# ── Experiments list ──────────────────────────────────────────
st.subheader(f"Experiments in '{selected_proj}'")
exps = get_experiments_for_project(proj_id)

if exps.empty:
    st.info("No experiments yet.")
else:
    status_colours = {
        "completed": "🟢", "running": "🔵",
        "failed": "🔴", "draft": "⚪",
    }
    for _, row in exps.iterrows():
        icon = status_colours.get(row["status"], "⚪")
        with st.container(border=True):
            c1, c2, c3, c4 = st.columns([3, 1, 1, 1])
            c1.markdown(f"{icon} **{row['name']}**")
            c1.caption(f"Dataset: {row['dataset']}")
            c2.write(f"`{row['status']}`")
            c3.caption(str(row["created_at"])[:10])

            # Status update
            new_status = c4.selectbox(
                "Update status",
                ["draft", "running", "completed", "failed"],
                index=["draft","running","completed","failed"].index(row["status"]),
                key=f"status_{row['experiment_id']}",
            )
            if new_status != row["status"]:
                update_experiment_status(int(row["experiment_id"]), new_status)
                st.rerun()

    st.divider()

    # ── Stored procedure call ─────────────────────────────────
    st.subheader("Experiment summary (stored procedure)")
    exp_names  = exps["name"].tolist()
    exp_pick   = st.selectbox("Pick experiment for summary", exp_names)
    exp_sel_id = int(exps.loc[exps["name"] == exp_pick, "experiment_id"].iloc[0])

    if st.button("Load summary via stored procedure"):
        try:
            summary = call_experiment_summary(exp_sel_id)
            if summary.empty:
                st.info("No runs found for this experiment.")
            else:
                st.dataframe(summary, use_container_width=True, hide_index=True)
        except Exception as e:
            st.error(f"Error: {e}")

    st.divider()

    # ── Tag management ────────────────────────────────────────
    st.subheader("Tag an experiment")
    tags_df = get_all_tags()

    col_t1, col_t2 = st.columns(2)
    with col_t1:
        tag_exp   = st.selectbox("Experiment to tag", exp_names, key="tag_exp")
        tag_exp_id = int(exps.loc[exps["name"] == tag_exp, "experiment_id"].iloc[0])

        if not tags_df.empty:
            tag_pick = st.selectbox("Tag", tags_df["name"].tolist())
            tag_id   = int(tags_df.loc[tags_df["name"] == tag_pick, "tag_id"].iloc[0])
            if st.button("Apply tag"):
                add_tag_to_experiment(tag_exp_id, tag_id)
                st.success(f"Tag '{tag_pick}' added to '{tag_exp}'.")

    with col_t2:
        st.markdown("**Create a new tag**")
        with st.form("new_tag"):
            tn = st.text_input("Tag name")
            tc = st.color_picker("Colour", "#7F77DD")
            if st.form_submit_button("Create tag"):
                if tn.strip():
                    create_tag(tn.strip(), tc)
                    st.success(f"Tag '{tn}' created.")
                    st.rerun()

    st.divider()
    st.subheader("Experiments with tags")
    tagged = get_experiments_with_tags()
    if not tagged.empty:
        st.dataframe(tagged, use_container_width=True, hide_index=True)
    else:
        st.info("No tags assigned yet.")
