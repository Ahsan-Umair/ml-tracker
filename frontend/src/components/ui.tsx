"use client";

import { AlertTriangle, LoaderCircle, Plus, X } from "lucide-react";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: () => void }) {
  return <section className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="heading-copy">{description}</p></div>{action&&<button className="primary-button" onClick={action}><Plus size={15}/>Add new</button>}</section>;
}

export function Modal({ title, description, open, onClose, children }: { title: string; description?: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17}/></button></div>{children}</section></div>;
}

export function SubmitButton({ pending, children="Save" }: { pending: boolean; children?: React.ReactNode }) { return <button className="primary-button form-submit" disabled={pending}>{pending?<><LoaderCircle className="spin" size={15}/>Saving…</>:children}</button>; }

export function EmptyState({ title, description, action }: { title: string; description: string; action?: () => void }) { return <div className="empty-state"><div className="empty-orbit"><Plus size={18}/></div><h3>{title}</h3><p>{description}</p>{action&&<button className="secondary-button" onClick={action}>Create the first one</button>}</div>; }

export function ErrorNotice({ message }: { message: string }) { return <div className="error-notice" role="alert"><AlertTriangle size={15}/>{message}</div>; }

export function StatusBadge({ value }: { value: string }) { return <span className={`status status-${value}`}>{value}</span>; }

export function CardSkeleton() { return <div className="resource-grid">{[1,2,3].map(i=><div className="resource-card skeleton" key={i}/>)}</div>; }

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>; }
