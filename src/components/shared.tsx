"use client";
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import type { LucideIcon } from "lucide-react";
export function Badge({ value }: { value: unknown }) {
  const text = String(value ?? "unknown").replaceAll("_", " ");
  const color = [
    "active",
    "completed",
    "paid",
    "answer",
    "available",
    "submitted",
  ].includes(text)
    ? "green"
    : ["trial", "assigned", "running", "issued", "demo"].includes(text)
      ? "purple"
      : [
            "pending",
            "pending verification",
            "draft",
            "reserved",
            "not connected",
            "review",
          ].includes(text)
        ? "amber"
        : ["failed", "error", "suspended", "closed", "disabled"].includes(text)
          ? "red"
          : "";
  return <span className={`badge ${color}`}>{text}</span>;
}
export function ErrorBanner({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div className="error-banner" role="alert">
      <AlertCircle size={16} />
      <span>{error.message}</span>
      {retry && (
        <Button size="sm" variant="ghost" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
export function LoadingRows() {
  return (
    <div aria-label="Loading data" role="status">
      {[1, 2, 3, 4].map((n) => (
        <div className="skeleton-row" key={n} />
      ))}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={23} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <LoaderCircle size={14} className="inline-loader" />}
      {children}
    </Button>
  );
}
export function Toast({
  message,
  dismiss,
}: {
  message: string;
  dismiss: () => void;
}) {
  return (
    <div className="toast" role="status">
      <CheckCircle2 size={17} />
      {message}
      <button
        className="icon-button"
        onClick={dismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
export type Row = Record<string, unknown>;
export const str = (row: Row, key: string) =>
  row[key] == null ? "—" : String(row[key]);
export const relation = (row: Row, key: string) =>
  (row[key] && typeof row[key] === "object" && !Array.isArray(row[key])
    ? row[key]
    : {}) as Row;
