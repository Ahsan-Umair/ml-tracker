"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

export type RecoveryResult = { recoveryCode: string; expiresAt: string };

export function RecoveryCode({ recoveryCode, expiresAt }: RecoveryResult) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(recoveryCode); setCopied(true); setError(""); }
    catch { setError("Select the code below and copy it, or download it."); }
  }
  function download() {
    const blob = new Blob([`Model Lab recovery code\n\n${recoveryCode}\n\nExpires: ${expiresAt}\nUse once at https://model-lab-rho.vercel.app/recover\nKeep this code private and separate from your password.\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "model-lab-recovery-code.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="recovery-code-box">
    <h3>Save your recovery code</h3>
    <p>This code replaces any previous recovery code. It works once, until {new Date(expiresAt).toLocaleDateString()}. Save it somewhere safe before leaving this page.</p>
    <label className="field"><span>Private recovery code</span><textarea readOnly value={recoveryCode} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
    <div className="recovery-actions"><button className="secondary-button" type="button" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy code"}</button><button className="secondary-button" type="button" onClick={download}><Download size={15} />Download</button></div>
    {error && <p role="status">{error}</p>}
  </div>;
}
