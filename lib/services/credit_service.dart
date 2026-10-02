import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/credit_ledger_entry.dart';

enum CreditErrorKind { insufficient, notFound, unauthenticated, other }

class CreditException implements Exception {
  CreditException(this.kind, this.message);
  final CreditErrorKind kind;
  final String message;

  factory CreditException.fromCode(String code, String? message) {
    final msg = message ?? code;
    if (code == 'failed-precondition' && msg.contains('insufficient-credits')) {
      return CreditException(CreditErrorKind.insufficient, msg);
    }
    return switch (code) {
      'not-found' => CreditException(CreditErrorKind.notFound, msg),
      'unauthenticated' || 'permission-denied' => CreditException(CreditErrorKind.unauthenticated, msg),
      _ => CreditException(CreditErrorKind.other, msg),
    };
  }

  @override
  String toString() => 'CreditException($kind, $message)';
}

class DownloadResult {
  const DownloadResult({required this.url, required this.charged, required this.balance});
  final String url;
  final bool charged;
  final int balance;
}

class WelcomeResult {
  const WelcomeResult({required this.granted, required this.balance});
  final bool granted; // false when the welcome grant was already claimed
  final int balance;
}

/// Calls a Cloud Function by name. Injected so tests never touch the network.
typedef CallableInvoker = Future<Map<String, dynamic>> Function(String name, Map<String, dynamic> data);

/// Read side of the credit ledger (Firestore, own docs only) plus the two
/// callables. The client never writes a balance — see `firestore.rules`.
class CreditService {
  CreditService(this._db, this._call);

  factory CreditService.live(FirebaseFirestore db) => CreditService(db, _liveInvoker);

  final FirebaseFirestore _db;
  final CallableInvoker _call;

  static Future<Map<String, dynamic>> _liveInvoker(String name, Map<String, dynamic> data) async {
    try {
      final res = await FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable(name)
          .call<Map<Object?, Object?>>(data);
      return Map<String, dynamic>.from(res.data);
    } on FirebaseFunctionsException catch (e) {
      throw CreditException.fromCode(e.code, e.message);
    }
  }

  Stream<int> streamBalance(String uid) => _db
      .collection('credit_balances')
      .doc(uid)
      .snapshots()
      .map((s) {
        final b = s.data()?['balance'];
        return (b is num && b.isFinite) ? b.toInt() : 0;
      });

  /// This user's own invitation code (issued server-side by `claimWelcome`); null until then.
  Stream<String?> streamInvitationCode(String uid) => _db
      .collection('credit_balances')
      .doc(uid)
      .snapshots()
      .map((s) {
        final c = s.data()?['invitationCode'];
        return c is String && c.isNotEmpty ? c : null;
      });

  Stream<List<CreditLedgerEntry>> streamLedger(String uid, {int limit = 50}) => _db
      .collection('credits_ledger')
      .where('uid', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((q) => q.docs.map((d) => CreditLedgerEntry.fromMap(d.id, d.data())).toList());

  /// Idempotent server-side; safe to call on every login.
  Future<WelcomeResult> claimWelcome() async {
    final r = await _call('claimWelcomeCredits', {});
    final b = r['balance'];
    return WelcomeResult(granted: r['granted'] == true, balance: b is num ? b.toInt() : 0);
  }

  Future<DownloadResult> downloadResource(String postId, {int fileIndex = 0}) async {
    final r = await _call('downloadResource', {'postId': postId, 'fileIndex': fileIndex});
    final b = r['balance'];
    return DownloadResult(
      url: r['url'] as String,
      charged: r['charged'] == true,
      balance: b is num ? b.toInt() : 0,
    );
  }
}
