import { useId } from 'react';

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string };

export function TextField({ label, error, hint, className = '', ...rest }: Props) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-label text-ink">{label}</label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || hint ? msgId : undefined}
        className="h-12 w-full rounded-m bg-surface-muted px-4 text-body text-ink outline-none ring-brand placeholder:text-ink-disabled focus:ring-2 aria-invalid:ring-2 aria-invalid:ring-danger"
        {...rest}
      />
      {error ? (
        <p id={msgId} className="mt-1 text-caption text-danger">{error}</p>
      ) : hint ? (
        <p id={msgId} className="mt-1 text-caption text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextArea({ label, error, className = '', ...rest }:
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string | null }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-label text-ink">{label}</label>
      <textarea id={id} aria-invalid={!!error}
        className="min-h-32 w-full rounded-m bg-surface-muted px-4 py-3 text-body text-ink outline-none ring-brand placeholder:text-ink-disabled focus:ring-2"
        {...rest} />
      {error ? <p className="mt-1 text-caption text-danger">{error}</p> : null}
    </div>
  );
}
