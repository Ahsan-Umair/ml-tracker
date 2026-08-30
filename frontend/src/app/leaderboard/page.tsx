"use client";

import { useQuery } from "@tanstack/react-query";
import { Medal, Trophy } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeading } from "@/components/ui";
import { api } from "@/lib/api";
type Row={id:string;run:string;experiment:string;model:string|null;version:string|null;score:number;rank:number;ended_at:string|null};const score=(v:number)=>`${(v<=1?v*100:v).toFixed(2)}%`;
export default function LeaderboardPage(){const{data=[]}=useQuery({queryKey:["leaderboard"],queryFn:()=>api<Row[]>("/leaderboard")});return <AppShell><PageHeading eyebrow="Best of the lab" title="Leaderboard" description="Compare completed evidence by experiment while keeping the model and version attached to every score."/><section className="panel leaderboard-panel">{data.length?<div className="table-scroll"><table><thead><tr><th>Rank</th><th>Run</th><th>Experiment</th><th>Model version</th><th>Best accuracy</th></tr></thead><tbody>{data.map(row=><tr key={row.id} className={row.rank===1?"winner-row":""}><td><span className={`rank rank-${row.rank}`}>{row.rank<=3?<Medal size={14}/>:null}{row.rank}</span></td><td><strong>{row.run}</strong></td><td className="muted">{row.experiment}</td><td className="muted">{row.model?`${row.model} · ${row.version}`:"Unlinked"}</td><td><strong>{score(row.score)}</strong></td></tr>)}</tbody></table></div>:<EmptyState title="The leaderboard is waiting" description="Log accuracy metrics on your runs and the strongest results will rank themselves here."/>}</section><div className="insight-banner"><Trophy size={19}/><div><strong>Ranking stays fair by design.</strong><p>Runs are ranked within their own experiment so unrelated tasks are never compared as if they were equivalent.</p></div></div></AppShell>}
