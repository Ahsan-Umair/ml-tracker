# app.py  — main entry point
# Run with: streamlit run app.py
import streamlit as st

st.set_page_config(
    page_title="ML Experiment Tracker",
    page_icon="🧪",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Session state for login ──────────────────────────────────
if "user" not in st.session_state:
    st.session_state.user = None

# ── Login / Register form (shown when not logged in) ─────────
if st.session_state.user is None:
    st.title("ML Dataset & Experiment Tracker")
    st.caption("University of Lahore — Database Systems Project")
    st.divider()

    tab_login, tab_register = st.tabs(["Login", "Register"])

    with tab_login:
        with st.form("login_form"):
            uname = st.text_input("Username")
            pwd   = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Login")

        if submitted:
            from db.queries import login_user
            user = login_user(uname, pwd)
            if user:
                st.session_state.user = user
                st.rerun()
            else:
                st.error("Invalid username or password.")

    with tab_register:
        with st.form("register_form"):
            new_uname = st.text_input("Username")
            new_email = st.text_input("Email")
            new_pwd   = st.text_input("Password", type="password")
            new_role  = st.selectbox("Role", ["researcher", "admin"])
            new_inst  = st.text_input("Institution (researchers only)")
            new_exp   = st.text_input("Area of expertise")
            reg_btn   = st.form_submit_button("Create account")

        if reg_btn:
            from db.queries import register_user
            ok = register_user(new_uname, new_email, new_pwd,
                               new_role, new_inst, new_exp)
            if ok:
                st.success("Account created! Please login.")
            else:
                st.error("Username or email already taken.")

# ── Main app (shown after login) ─────────────────────────────
else:
    user = st.session_state.user

    with st.sidebar:
        st.markdown(f"**{user['username']}** `{user['role']}`")
        st.divider()
        st.page_link("pages/01_dashboard.py",   label="Dashboard",    icon="📊")
        st.page_link("pages/02_projects.py",    label="Projects",     icon="📁")
        st.page_link("pages/03_experiments.py", label="Experiments",  icon="🔬")
        st.page_link("pages/04_runs.py",        label="Runs",         icon="▶️")
        st.page_link("pages/05_metrics.py",     label="Metrics",      icon="📈")
        st.page_link("pages/06_leaderboard.py", label="Leaderboard",  icon="🏆")
        st.divider()
        if st.button("Logout"):
            st.session_state.user = None
            st.rerun()

    st.title("ML Dataset & Experiment Tracker")
    st.info("Use the sidebar to navigate between pages.")
