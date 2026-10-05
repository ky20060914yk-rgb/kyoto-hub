import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart' as fb_auth;

/// Minimal FirebaseAuth stand-in: a controllable `authStateChanges` stream and a
/// counting `signOut`. Anything else throws (noSuchMethod), so a test only
/// exercises what it declares.
class FakeAuth implements fb_auth.FirebaseAuth {
  final StreamController<fb_auth.User?> _states = StreamController<fb_auth.User?>.broadcast(sync: true);
  int signOutCalls = 0;
  bool failSignOut = false;
  fb_auth.User? _current;

  @override
  fb_auth.User? get currentUser => _current;

  @override
  Stream<fb_auth.User?> authStateChanges() => _states.stream;

  @override
  Future<void> signOut() async {
    signOutCalls++;
    if (failSignOut) throw StateError('network');
    _current = null;
    _states.add(null);
  }

  /// Emits a signed-in user (as the SDK does after a reload or sign-in).
  void emitUser(fb_auth.User user) {
    _current = user;
    _states.add(user);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class FakeUser implements fb_auth.User {
  FakeUser(this.uid, {this.emailVerified = true});

  @override
  final String uid;
  @override
  final bool emailVerified;
  @override
  String? get email => '$uid@st.kyoto-u.ac.jp';

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}
