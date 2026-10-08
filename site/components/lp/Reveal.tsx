'use client';

import { useEffect, useRef, useState } from 'react';

/** Fades content up once when it scrolls into view (design.md §5.3). Visible by default without JS. */
export function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: 0 | 1 | 2 | 3; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'hidden' | 'shown'>('idle');
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen: no animation
    setState('hidden');
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setState('shown');
        io.disconnect();
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const delays = ['', 'delay-60', 'delay-120', 'delay-180'];
  return (
    <div ref={ref} className={`${state === 'hidden' ? 'opacity-0' : ''} ${state === 'shown' ? `animate-rise ${delays[delay]}` : ''} ${className}`}>
      {children}
    </div>
  );
}

/** Counts up to `value` once when visible (800ms). */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / 800);
        setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      setN(0);
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return <span ref={ref} className="tabular">{n.toLocaleString('ja-JP')}</span>;
}
