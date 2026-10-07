import {
  createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { auth, db } from './client';
import { isKuEmail } from '@/lib/ku';

export const MIN_PASSWORD = 8;

export async function signUp(email: string, password: string, referralCode?: string) {
  const address = email.trim().toLowerCase();
  if (!isKuEmail(address)) throw new Error('京大のメールアドレス（@st.kyoto-u.ac.jp）で登録してください。');
  if (password.length < MIN_PASSWORD) throw new Error(`パスワードは${MIN_PASSWORD}文字以上にしてください。`);
  const { user } = await createUserWithEmailAndPassword(auth, address, password);
  // Same document shape as the Flutter app wrote, so both clients read it.
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    university_id: 'kyoto_u',
    email: address,
    displayName: `京大生_${Math.floor(Math.random() * 9000) + 1000}`,
    points: 0,
    invitationCode: '',
    createdAt: new Date().toISOString(),
    downloadCount: 0,
    isVerified: false,
    pendingReferralCode: referralCode?.trim().toUpperCase() || null,
  });
  await sendEmailVerification(user);
}

export async function signIn(email: string, password: string) {
  const { user } = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  return user;
}

export async function resendVerification() {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

// reload() refreshes the user record but not the cached ID token that the
// rules and the server read, so force a token refresh too.
export async function refreshVerified(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
}

export async function resetPassword(email: string) {
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  } catch (e) {
    // Do not reveal whether the address exists.
    if (!(e instanceof FirebaseError && e.code === 'auth/user-not-found')) throw e;
  }
}

export const signOutUser = () => signOut(auth);

export function authErrorMessage(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'auth/email-already-in-use': return 'このメールアドレスは登録済みです。ログインしてください。';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found': return 'メールアドレスかパスワードが違います。';
      case 'auth/too-many-requests': return '試行回数が多すぎます。しばらく待ってからもう一度お試しください。';
      case 'auth/network-request-failed': return '通信に失敗しました。接続を確認してください。';
      case 'auth/invalid-email': return 'メールアドレスの形式が正しくありません。';
      case 'auth/weak-password': return `パスワードは${MIN_PASSWORD}文字以上にしてください。`;
    }
  }
  return e instanceof Error ? e.message : 'エラーが発生しました。もう一度お試しください。';
}
