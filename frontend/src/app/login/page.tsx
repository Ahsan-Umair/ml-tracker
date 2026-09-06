"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { ArrowRight, BrainCircuit, ChartNoAxesCombined, Sparkles } from "lucide-react";
import { useAuth, User } from "@/components/providers";
import { api, messageOf } from "@/lib/api";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

function LoginForm() {
  const router = useRouter(); const params = useSearchParams(); const { user, setSession } = useAuth();
  const [pending,setPending]=useState(false); const [error,setError]=useState("");
  const requested = params.get("next") || "/dashboard";
  const destination = /^\/(dashboard|projects|datasets|models|experiments|runs|leaderboard|analytics|settings)$/.test(requested) ? requested : "/dashboard";
  useEffect(()=>{if(user)router.replace(destination)},[user,router,destination]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setPending(true);setError("");const data=new FormData(event.currentTarget);try{const result=await api<{user:User;csrfToken:string}>("/auth/login",{method:"POST",body:JSON.stringify({email:data.get("email"),password:data.get("password")})});setSession(result.user,result.csrfToken);router.replace(destination)}catch(e){setError(messageOf(e))}finally{setPending(false)}}
  return <form className="auth-form" onSubmit={submit}>
    {error&&<ErrorNotice message={error}/>}
    <Field label="Email"><input name="email" type="email" autoComplete="username" placeholder="you@example.com" required/></Field>
    <p className="auth-switch"><Link href="/recover">Forgot password?</Link></p>
    <PasswordInput name="password" label="Password" autoComplete="current-password" />
    <p className="password-help">If iCloud Passwords covers a field, press Esc to close its suggestion menu.</p>
    <SubmitButton pending={pending}>Sign in <ArrowRight size={15}/></SubmitButton>
    <p className="auth-switch">New to Model Lab? <Link href="/register">Create an account</Link></p>
  </form>;
}

export default function LoginPage(){return <main className="auth-page"><section className="auth-showcase"><Link href="/" className="brand"><span className="brand-mark"><Sparkles size={18}/></span>Model Lab</Link><div className="auth-pitch"><p className="eyebrow">Your private ML workspace</p><h1>Every model has a story. Keep yours.</h1><p>Bring projects, versions, experiments, runs, and metrics into one calm, searchable workspace.</p><div className="auth-proof"><span><BrainCircuit size={16}/>Model registry</span><span><ChartNoAxesCombined size={16}/>Live metrics</span></div></div><div className="auth-art" aria-hidden="true"><div className="art-card art-a">94.8%<small>validation accuracy</small></div><div className="art-card art-b">run_0124 <small>completed · 24m</small></div><div className="art-orbit"/></div></section><section className="auth-panel"><div className="auth-box"><p className="eyebrow">Welcome back</p><h2>Sign in to your lab</h2><p className="auth-copy">Continue tracking the work behind your best models.</p><Suspense><LoginForm/></Suspense></div></section></main>}
