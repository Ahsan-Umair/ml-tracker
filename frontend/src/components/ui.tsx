"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, LoaderCircle, Plus, X } from "lucide-react";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
  actionLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
}) {
  const labels: Record<string, string> = {
    Projects: "New project",
    Models: "Register model",
    Experiments: "New experiment",
    Runs: "Log a run",
    Datasets: "Register dataset",
  };
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="heading-copy">{description}</p>
      </div>
      {action && (
        <button className="primary-button" onClick={action}>
          <Plus size={15} />
          {actionLabel || labels[title] || "Create new"}
        </button>
      )}
    </section>
  );
}

export function Modal({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <p className="eyebrow">MODEL LAB</p>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function SubmitButton({
  pending,
  pendingLabel = "Saving…",
  children = "Save",
}: {
  pending: boolean;
  pendingLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      className="primary-button form-submit"
      type="submit"
      disabled={pending}
    >
      {pending ? (
        <>
          <LoaderCircle className="spin" size={15} />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <Plus size={18} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="secondary-button" onClick={action}>
          Create the first one
        </button>
      )}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="error-notice" role="alert">
      <AlertTriangle size={15} />
      {message}
    </div>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value}</span>;
}

export function CardSkeleton() {
  return (
    <div className="resource-grid">
      {[1, 2, 3].map((i) => (
        <div className="resource-card skeleton" key={i} />
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
