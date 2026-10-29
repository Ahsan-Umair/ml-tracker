"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
} from "react";
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
  pending = false,
  protectDraft = true,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  pending?: boolean;
  protectDraft?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const titleId = useId();
  function close() {
    if (pending || ref.current?.querySelector('button[aria-busy="true"]')) {
      return;
    }
    if (
      protectDraft &&
      dirty.current &&
      !window.confirm("Discard the changes in this form?")
    )
      return;
    dirty.current = false;
    onClose();
  }
  useEffect(() => {
    if (!open) return;
    dirty.current = false;
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
  useEffect(() => {
    if (!open || !protectDraft) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current) event.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [open, protectDraft]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onInputCapture={() => {
        dirty.current = true;
      }}
      onChangeCapture={() => {
        dirty.current = true;
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
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
          close();
      }}
    >
      <div className="modal-header">
        <div>
          <p className="eyebrow">MODEL LAB</p>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Close"
          disabled={pending}
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
  disabled = false,
  children = "Save",
}: {
  pending: boolean;
  pendingLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      className="primary-button form-submit"
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
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
  const labelId = useId();
  const hintId = `${labelId}-hint`;
  const controls = Children.map(children, (child) => {
    if (
      !isValidElement(child) ||
      typeof child.type !== "string" ||
      !["input", "select", "textarea"].includes(child.type)
    )
      return child;
    const control = child as ReactElement<React.AriaAttributes>;
    return cloneElement(control, {
      "aria-labelledby": control.props["aria-labelledby"] || labelId,
      "aria-describedby":
        control.props["aria-describedby"] || (hint ? hintId : undefined),
    });
  });
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {controls}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
