// Creates a verified KU test user on the Auth emulator. Usage: node scripts/make-user.mjs <email> <password>
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Refusing to run without FIREBASE_AUTH_EMULATOR_HOST');
const [email, password] = process.argv.slice(2);
const app = initializeApp({ projectId: 'kyodai-sns' });
const user = await getAuth(app).createUser({ email, password, emailVerified: true });
await getFirestore(app).collection('users').doc(user.uid).set({
  uid: user.uid, university_id: 'kyoto_u', email, displayName: `京大生_${Math.floor(Math.random() * 9000) + 1000}`,
  points: 0, invitationCode: '', createdAt: new Date().toISOString(), downloadCount: 0, isVerified: true, pendingReferralCode: null,
});
console.log(user.uid);
