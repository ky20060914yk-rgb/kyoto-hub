// Same pattern as firestore.rules kuVerified(): start-anchored, one '@', lower-cased.
export const KU_DOMAIN = 'st.kyoto-u.ac.jp';

export function isKuEmail(email: string): boolean {
  return /^[^@\s]+@st[.]kyoto-u[.]ac[.]jp$/.test(email.toLowerCase());
}
