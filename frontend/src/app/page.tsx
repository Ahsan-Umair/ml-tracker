import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  // Presence only selects the first screen. The API still validates every session.
  const hasSession = (await cookies()).has("ml_session");
  redirect(hasSession ? "/dashboard" : "/login");
}
