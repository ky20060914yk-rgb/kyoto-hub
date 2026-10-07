export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-m bg-surface-muted ${className}`} aria-hidden />;
}

export function EmptyState({ icon, title, body, action }:
  { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="text-ink-disabled">{icon}</div>
      <p className="mt-3 text-heading">{title}</p>
      {body ? <p className="mt-1 max-w-content text-caption text-ink-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
