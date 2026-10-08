'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { addDoc, collection, doc, limitToLast, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';
import { AppBar } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { StarGlyph } from '@/components/course/bits';
import { MAX_MESSAGE } from '@/lib/domain/textbook';

type Chat = { id: string; listingId: string; listingTitle: string; sellerId: string; sellerName: string; buyerId: string; buyerName: string; status: string; ratedBy: string[] };
type Msg = { id: string; senderId: string; text: string; createdAt: string };

export default function ChatRoom() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [chat, setChat] = useState<Chat | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => onSnapshot(doc(db, 'chats', id), (s) => setChat(s.data() as Chat), () => setError('この取引は表示できません。')), [id]);
  useEffect(() => onSnapshot(query(collection(db, 'chats', id, 'messages'), orderBy('createdAt'), limitToLast(200)),
    (s) => setMsgs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Msg, 'id'>) })))), [id]);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!user || !t) return;
    setText('');
    const now = new Date().toISOString();
    try {
      await addDoc(collection(db, 'chats', id, 'messages'), { senderId: user.uid, text: t.slice(0, MAX_MESSAGE), createdAt: now });
      await updateDoc(doc(db, 'chats', id), { lastMessage: t.slice(0, 100), lastAt: now });
    } catch {
      setError('送信できませんでした。');
      setText(t);
    }
  }

  if (error && !chat) return (<><AppBar title="取引" back="/textbooks/chats" /><p className="p-6 text-center text-caption text-ink-2">{error}</p></>);
  if (!chat || !user) return (<><AppBar title="取引" back="/textbooks/chats" /><main className="p-4"><Skeleton className="h-80" /></main></>);

  const other = chat.sellerId === user.uid ? chat.buyerName : chat.sellerName;
  const done = chat.status === 'done';
  const rated = chat.ratedBy?.includes(user.uid);

  return (
    <>
      <AppBar title={`${other}さんとの取引`} back="/textbooks/chats" />
      <main className="mx-auto flex min-h-chat max-w-content flex-col px-4">
        <Link href={`/textbooks/${chat.listingId}`} className="mt-3 flex items-center gap-2 rounded-m border border-line bg-surface px-3 py-2 text-caption hover:bg-surface-muted">
          <Icon name="book" className="size-4 text-ink-2" /><span className="flex-1 truncate">{chat.listingTitle}</span><Icon name="chevronRight" className="size-4 text-ink-disabled" />
        </Link>
        <p className="mt-2 text-center text-label text-ink-2">受け渡しの日時と場所を決めましょう。代金は受け渡しのときに直接。</p>

        <ol className="flex flex-1 flex-col gap-2 py-4" aria-live="polite">
          {msgs.map((m) => {
            const me = m.senderId === user.uid;
            return (
              <li key={m.id} className={`flex animate-fade-in ${me ? 'justify-end' : 'justify-start'}`}>
                <span className={`max-w-[80%] whitespace-pre-wrap rounded-l px-3 py-2 text-body ${me ? 'bg-brand text-on-brand' : 'border border-line bg-surface text-ink'}`}>{m.text}</span>
              </li>
            );
          })}
          <div ref={bottom} />
        </ol>

        {done ? (
          <div className="mb-4 rounded-l border border-line bg-surface p-4">
            <p className="text-heading">取引が完了しました</p>
            {rated ? <p className="mt-1 text-caption text-ink-2">評価ありがとうございました。</p> : (
              <form className="mt-3 flex flex-col gap-3" onSubmit={async (e) => {
                e.preventDefault();
                await api('/api/textbooks/chats', { method: 'PATCH', json: { chatId: id, action: 'rate', stars, comment } }).catch((x) => setError(x.message));
              }}>
                <div className="flex" role="radiogroup" aria-label={`${other}さんの評価`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <button key={i} type="button" role="radio" aria-checked={stars === i} aria-label={`${i}点`} onClick={() => setStars(i)} className="grid size-tap place-items-center">
                      <StarGlyph fill={stars >= i ? 1 : 0} className="size-7" />
                    </button>
                  ))}
                </div>
                <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={200} placeholder="ひとこと（任意）"
                  className="h-11 rounded-m bg-surface-muted px-3 text-body outline-none ring-brand focus:ring-2" />
                <Button type="submit" disabled={!stars}>評価する</Button>
              </form>
            )}
          </div>
        ) : (
          <div className="sticky bottom-16 mb-2 flex flex-col gap-2 bg-canvas pb-2 md:bottom-0">
            {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
            <form onSubmit={send} className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_MESSAGE} placeholder="メッセージ" aria-label="メッセージ"
                className="h-12 min-w-0 flex-1 rounded-m bg-surface px-4 text-body outline-none ring-1 ring-line focus:ring-2 focus:ring-brand" />
              <Button type="submit" disabled={!text.trim()}>送信</Button>
            </form>
            <Button variant="text" size="sm" onClick={async () => {
              if (confirm('受け渡しが終わりましたか？ 取引を完了にすると出品は締め切られます。')) {
                await api('/api/textbooks/chats', { method: 'PATCH', json: { chatId: id, action: 'complete' } }).catch((x) => setError(x.message));
              }
            }}>受け渡しが終わったら：取引を完了にする</Button>
          </div>
        )}
      </main>
    </>
  );
}
