import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'text' | 'danger';
type Size = 'md' | 'sm';

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium transition-colors duration-instant ease-out-cubic disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled disabled:border-transparent';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-pressed active:bg-brand-pressed',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-muted active:bg-surface-muted',
  text: 'text-brand hover:bg-brand-subtle active:bg-brand-subtle',
  danger: 'bg-danger text-on-brand hover:opacity-90',
};
const SIZE: Record<Size, string> = { md: 'h-12 px-5 rounded-m text-body', sm: 'h-8 px-3 rounded-full text-label' };

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
}

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...rest }: Props) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', size = 'md', className = '', children }:
  { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={buttonClass(variant, size, className)}>{children}</Link>;
}
