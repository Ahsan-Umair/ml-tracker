const workspacePath =
  /^\/(dashboard|projects|datasets|models|experiments|runs|leaderboard|analytics|settings)(?:\/[a-zA-Z0-9_-]+)*\/?$/;

/** Preserve resource deep links while keeping authentication redirects on this site. */
export function safeWorkspaceDestination(requested: string | null): string {
  if (!requested || !requested.startsWith("/") || requested.startsWith("//"))
    return "/dashboard";
  try {
    const url = new URL(requested, "https://model-lab.invalid");
    if (
      url.origin !== "https://model-lab.invalid" ||
      !workspacePath.test(url.pathname)
    )
      return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
