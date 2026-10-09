'use client';

type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;

/**
 * Tells the browser the sign-in succeeded so it offers to save the password.
 * The app switches screens without a page load, so Chrome / Edge would not
 * notice on their own. No-op where the Credential Management API is missing.
 */
export async function offerToSavePassword(id: string, password: string) {
  const Ctor = (window as unknown as { PasswordCredential?: PasswordCredentialCtor }).PasswordCredential;
  if (!Ctor || !navigator.credentials?.store) return;
  try {
    await navigator.credentials.store(new Ctor({ id: id.trim().toLowerCase(), password, name: id.trim().toLowerCase() }));
  } catch {
    /* the user dismissed it or the browser refused: nothing to do */
  }
}
