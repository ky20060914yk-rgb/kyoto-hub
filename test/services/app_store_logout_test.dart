import 'package:flutter_test/flutter_test.dart';

import '../support/fake_auth.dart';
import '../support/store_harness.dart';

// Logout must really sign out of Firebase Auth (its session is persisted, so a
// reload would otherwise restore the user), reset state exactly once, and not
// fight the auth-state listener.

Future<void> _pump() => Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  test('logout signs out of Firebase Auth and clears the session state', () async {
    final auth = FakeAuth();
    final h = Harness(auth: auth);
    h.signIn();
    h.store.userTimetable = {'Mon_1': 'c1'};
    h.store.creditBalance = 5;
    await h.store.logout();
    expect(auth.signOutCalls, 1);
    expect([h.store.currentUser, h.store.userTimetable, h.store.creditBalance], [null, <String, String>{}, 0]);
    await _pump(); // the null auth event that signOut emits must not reset or sign out again
    expect(auth.signOutCalls, 1);
  });

  test('sign-out resets state once: listeners fire once from logout, not again from the auth event', () async {
    final auth = FakeAuth();
    final h = Harness(auth: auth);
    await _pump();
    h.signIn();
    var notifications = 0;
    h.store.addListener(() => notifications++);
    await h.store.logout();
    await _pump();
    expect(notifications, 1);
  });

  test('an auth event with no user (session ended elsewhere) clears a signed-in store', () async {
    final auth = FakeAuth();
    final h = Harness(auth: auth);
    await _pump();
    h.signIn();
    await auth.signOut();
    await _pump();
    expect(h.store.currentUser, isNull);
  });

  test('a failed signOut still clears local state and tells the user', () async {
    final auth = FakeAuth()..failSignOut = true;
    final h = Harness(auth: auth);
    h.signIn();
    await h.store.logout();
    expect(h.store.currentUser, isNull);
    expect(h.store.lastNoticeMessage, contains('ログアウトに失敗'));
  });

  test('logout re-arms the policy notice for the next account', () async {
    final auth = FakeAuth();
    final h = Harness(auth: auth);
    h.signIn();
    expect(h.store.shouldShowPolicyNotice, isTrue);
    await h.store.markPolicyNoticeSeen();
    await h.store.logout();
    h.signIn(uid: 'u2');
    expect(h.store.shouldShowPolicyNotice, isTrue);
  });

  test('a profile that finishes loading after logout does not sign the user back in', () async {
    final auth = FakeAuth();
    final h = Harness(auth: auth);
    await _pump();
    await h.db.collection('users').doc('u9').set({
      'uid': 'u9', 'email': 'u9@st.kyoto-u.ac.jp', 'displayName': 'x', 'universityId': 'kyoto_u',
      'createdAt': DateTime(2026).toIso8601String(), 'isVerified': true,
    });
    auth.emitUser(FakeUser('u9')); // starts loading the profile
    await auth.signOut(); // ...and the user signs out before it lands
    await _pump();
    expect(h.store.currentUser, isNull);
  });
}
