/** Long-form legal text with design.md typography (line length ≤ 40em, line-height 1.8). */
export function Prose({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="text-body text-ink [&_h2]:mt-10 [&_h2]:text-heading [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
      <h1 className="text-title">{title}</h1>
      <p className="mt-1 text-caption text-ink-2">最終更新日：{updated}</p>
      {children}
    </article>
  );
}
