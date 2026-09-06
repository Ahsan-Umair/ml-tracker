"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput({ name, label, autoComplete, minLength = 1, hint }: {
  name: string; label: string; autoComplete: "current-password" | "new-password";
  minLength?: number; hint?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return <div className="field password-control">
    <div className="password-label-row">
      <label htmlFor={id}>{label}</label>
      <button type="button" className="password-toggle" aria-controls={id} aria-pressed={show}
        aria-label={`${show ? "Hide" : "Show"} ${label.toLowerCase()}`} onClick={() => setShow(!show)}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}{show ? "Hide" : "Show"}
      </button>
    </div>
    <input id={id} name={name} type={show ? "text" : "password"} autoComplete={autoComplete}
      minLength={minLength} maxLength={128} required spellCheck={false} autoCapitalize="none"
      aria-describedby={hint ? `${id}-hint` : undefined} />
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </div>;
}
