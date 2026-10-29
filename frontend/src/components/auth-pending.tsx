"use client";
import { useEffect, useState } from "react";
export function AuthPending() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return slow ? (
    <p className="connection-notice" role="status">
      Connecting to your workspace. After a break, the server can take a little
      longer to respond. You can leave this page open.
    </p>
  ) : null;
}
