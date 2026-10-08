import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminBucket } from './admin';
import { CREDITS, jstDay, ledgerRef, readBalance, writeCredit } from './credits';
import { getCourseOr404 } from './reviews';
import { notify } from './notify';
import type { KuUser } from './auth';
import { HttpError } from '@/lib/http-error';
import { slug } from '@/lib/domain/review';
import {
  ALLOWED_TYPES, MAX_FILES, MAX_FILE_BYTES, REPORT_THRESHOLD, dedupKey, isPastExam, safeFileName,
  type RequestInput, type ResourceInput,
} from '@/lib/domain/resource';

const posts = () => adminDb.collection('posts');
const requests = () => adminDb.collection('requests');
const statsRef = (courseKey: string) => adminDb.collection('course_stats').doc(slug(courseKey));
const pendingPrefix = (uid: string, uploadId: string) => `uploads/${uid}/pending/${uploadId}/`;

/** Storage access, injectable for tests. */
export type Files = {
  list(prefix: string): Promise<{ path: string; size: number; contentType: string }[]>;
  move(from: string, to: string): Promise<void>;
  read(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
};

export const bucketFiles: Files = {
  async list(prefix) {
    const [files] = await adminBucket.getFiles({ prefix });
    return files.map((f) => ({ path: f.name, size: Number(f.metadata.size ?? 0), contentType: String(f.metadata.contentType ?? '') }));
  },
  async move(from, to) {
    await adminBucket.file(from).move(to);
  },
  async read(path) {
    const [buf] = await adminBucket.file(path).download();
    return buf;
  },
  async remove(path) {
    await adminBucket.file(path).delete({ ignoreNotFound: true });
  },
};

async function authorName(uid: string) {
  return ((await adminDb.collection('users').doc(uid).get()).data()?.displayName as string) || '京大生';
}

/**
 * Publishes files the user uploaded to `uploads/{uid}/pending/{uploadId}/`:
 * validates them, moves them to `resources/{postId}/`, writes the post, bumps
 * the course counters and grants credits (upload +3 unless a same-shaped post
 * exists; request fulfilment +3; both under the 3-per-JST-day cap, P2-3/P2-10).
 */
export async function createResource(user: KuUser, input: ResourceInput, files: Files = bucketFiles, now = new Date()) {
  const course = await getCourseOr404(input.courseId);
  const uploaded = await files.list(pendingPrefix(user.uid, input.uploadId));
  if (uploaded.length === 0) throw new HttpError(400, 'ファイルが見つかりません。もう一度アップロードしてください。');
  if (uploaded.length > MAX_FILES) throw new HttpError(400, `ファイルは${MAX_FILES}個までです。`);
  for (const f of uploaded) {
    if (f.size > MAX_FILE_BYTES) throw new HttpError(400, 'ファイルは1つ20MBまでです。');
    if (!ALLOWED_TYPES.includes(f.contentType)) throw new HttpError(400, 'PDFか画像ファイルを選んでください。');
  }

  const ref = posts().doc();
  const fileNames = uploaded.map((f) => safeFileName(f.path.split('/').pop() ?? 'file'));
  const filePaths = fileNames.map((n, i) => `resources/${ref.id}/${i}_${n}`);
  for (let i = 0; i < uploaded.length; i++) await files.move(uploaded[i].path, filePaths[i]);

  const key = dedupKey(course.courseKey, input);
  const name = await authorName(user.uid);
  const iso = now.toISOString();

  const result = await adminDb.runTransaction(async (tx) => {
    // ---- reads
    const dup = !(await tx.get(posts().where('dedupKey', '==', key).limit(1))).empty;
    const reqSnap = input.requestId ? await tx.get(requests().doc(input.requestId)) : null;
    const uploadLed = await tx.get(ledgerRef(`upload_${ref.id}`));
    const fulfilLed = input.requestId ? await tx.get(ledgerRef(`fulfill_${input.requestId}`)) : null;
    let cur = await readBalance(tx, user.uid);

    const req = reqSnap?.exists ? reqSnap.data()! : null;
    const fulfils = !!req && !req.isFulfilled && req.courseKey === course.courseKey && req.authorId !== user.uid;

    // ---- writes
    tx.set(ref, {
      id: ref.id, university_id: 'kyoto_u', courseId: course.id, subjectId: course.id, courseKey: course.courseKey,
      subjectName: course.name, authorId: user.uid, authorName: name, category: input.category, year: input.year,
      examType: input.examType, title: input.title, description: input.description, filePaths, fileNames,
      fileUrls: [], downloadCost: CREDITS.downloadCost, downloadCount: 0, createdAt: iso,
      requestId: fulfils ? input.requestId : null, reports: [], hidden: false, dedupKey: key,
    });
    tx.set(statsRef(course.courseKey), {
      courseKey: course.courseKey, university_id: 'kyoto_u',
      [isPastExam(input.category) ? 'pastExamPostCount' : 'resourcePostCount']: FieldValue.increment(1),
    }, { merge: true });

    const day = jstDay(now);
    let used = cur.uploadGrantDay === day ? cur.uploadGrantsToday ?? 0 : 0;
    let granted = 0;
    let capped = false;
    const grant = (delta: number, reason: string, ledgerId: string, refId: string) => {
      if (used >= CREDITS.dailyGrantCap) {
        capped = true;
        return;
      }
      used += 1;
      cur = writeCredit(tx, { uid: user.uid, delta, reason, ledgerId, refId }, cur, { uploadGrantDay: day, uploadGrantsToday: used });
      granted += delta;
    };
    if (fulfils && !fulfilLed?.exists) {
      tx.update(requests().doc(input.requestId!), { isFulfilled: true, fulfilledPostId: ref.id, fulfilledAt: iso });
      grant(CREDITS.requestFulfilled, 'request_fulfilled', `fulfill_${input.requestId}`, input.requestId!);
      notify({ uid: req!.authorId, kind: 'request_fulfilled', title: `リクエストした「${req!.title}」が届きました`,
        body: `${course.name}・無料でダウンロードできます`, href: `/courses/${course.id}?tab=resources` }, tx);
    }
    if (!dup && !uploadLed.exists) grant(CREDITS.upload, 'upload', `upload_${ref.id}`, ref.id);
    return { postId: ref.id, granted, duplicate: dup, capped, fulfilled: fulfils };
  });
  return { ...result, courseId: course.id };
}

/**
 * Charges 1 credit the first time a user opens a post (re-downloads are free,
 * P2-4); own posts and posts that fulfilled the user's request are free.
 * Returns the file bytes — the bucket is private and is never exposed by URL.
 */
export async function downloadResource(user: KuUser, postId: string, fileIndex: number, files: Files = bucketFiles) {
  const postRef = posts().doc(postId);
  const post = (await postRef.get()).data();
  if (!post || post.hidden) throw new HttpError(404, '資料が見つかりません。');
  const paths: string[] = Array.isArray(post.filePaths) ? post.filePaths : [];
  if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= paths.length) throw new HttpError(400, 'ファイルの指定が正しくありません。');

  const isAuthor = post.authorId === user.uid;
  let free = isAuthor;
  if (!free && post.requestId) {
    const r = await requests().doc(String(post.requestId)).get();
    free = r.data()?.authorId === user.uid;
  }

  const ledgerId = `dl_${user.uid}_${postId}`;
  const outcome = await adminDb.runTransaction(async (tx) => {
    const led = await tx.get(ledgerRef(ledgerId));
    const cur = await readBalance(tx, user.uid);
    if (led.exists) return { charged: false, balance: cur.balance };
    const next = writeCredit(tx, { uid: user.uid, delta: free ? 0 : -CREDITS.downloadCost, reason: free ? 'download_free' : 'download', ledgerId, refId: postId }, cur);
    if (!isAuthor) tx.update(postRef, { downloadCount: FieldValue.increment(1) });
    return { charged: !free, balance: next.balance };
  });

  const names: string[] = Array.isArray(post.fileNames) ? post.fileNames : [];
  const filename = names[fileIndex] ?? paths[fileIndex].split('/').pop() ?? 'download';
  return { ...outcome, filename, bytes: await files.read(paths[fileIndex]) };
}

export async function createRequest(user: KuUser, input: RequestInput, now = new Date()) {
  const course = await getCourseOr404(input.courseId);
  const open = await requests().where('authorId', '==', user.uid).where('isFulfilled', '==', false).count().get();
  if (open.data().count >= 10) throw new HttpError(429, '未解決のリクエストは10件までです。');
  const ref = requests().doc();
  await ref.set({
    id: ref.id, university_id: 'kyoto_u', courseId: course.id, subjectId: course.id, courseKey: course.courseKey,
    subjectName: course.name, authorId: user.uid, authorName: await authorName(user.uid), category: input.category,
    year: input.year, title: input.title, description: input.description, costSpent: 0, rewardPoints: CREDITS.requestFulfilled,
    isFulfilled: false, fulfilledPostId: null, createdAt: now.toISOString(),
  });
  return { requestId: ref.id, courseId: course.id };
}

/** One report per account; at REPORT_THRESHOLD the post is hidden and queued for moderation. */
export async function reportPost(user: KuUser, postId: string, reason: string) {
  const ref = posts().doc(postId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, '資料が見つかりません。');
    const p = snap.data()!;
    const reports: string[] = Array.isArray(p.reports) ? p.reports : [];
    if (p.authorId === user.uid) throw new HttpError(403, '自分の投稿は通報できません。');
    if (reports.includes(user.uid)) return { hidden: !!p.hidden, already: true };
    const hide = reports.length + 1 >= REPORT_THRESHOLD;
    tx.update(ref, { reports: FieldValue.arrayUnion(user.uid), ...(hide ? { hidden: true } : {}) });
    tx.create(adminDb.collection('moderation_queue').doc(), {
      kind: 'report', postId, reporter: user.uid, reason: reason.slice(0, 500), hiddenNow: hide,
      priority: false, createdAt: new Date().toISOString(), status: 'open',
    });
    return { hidden: hide, already: false };
  });
}

/** Rights-holder takedown: hide immediately, queue with priority (spec A3). Credits are never clawed back. */
export async function requestTakedown(input: { postId: string; name: string; email: string; affiliation: string; detail: string }) {
  const ref = posts().doc(input.postId);
  const snap = await ref.get();
  await adminDb.runTransaction(async (tx) => {
    if (snap.exists) tx.update(ref, { hidden: true });
    tx.create(adminDb.collection('moderation_queue').doc(), {
      kind: 'takedown', postId: input.postId, postFound: snap.exists, name: input.name, email: input.email,
      affiliation: input.affiliation, detail: input.detail, priority: true, createdAt: new Date().toISOString(), status: 'open',
    });
  });
  if (snap.exists) {
    const p = snap.data()!;
    await notify({ uid: p.authorId, kind: 'resource_removed', title: `「${p.title}」が権利者の申し立てにより非公開になりました`,
      body: '獲得したクレジットはそのままです。' });
  }
  return { ok: true };
}
