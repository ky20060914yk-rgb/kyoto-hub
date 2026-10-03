import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/app_notification.dart';
import 'credit_service.dart' show CallableInvoker;

/// Wire values must equal `REPORT_CATEGORIES` in functions/src/report.ts.
enum ReportCategory { copyright, unrelated, inappropriate, other }

extension ReportCategoryX on ReportCategory {
  String get value => switch (this) {
        ReportCategory.copyright => 'copyright',
        ReportCategory.unrelated => 'unrelated',
        ReportCategory.inappropriate => 'inappropriate',
        ReportCategory.other => 'other',
      };

  String get label => switch (this) {
        ReportCategory.copyright => '著作権侵害・無断転載',
        ReportCategory.unrelated => '科目と関係のないファイル',
        ReportCategory.inappropriate => '不適切な内容',
        ReportCategory.other => 'その他',
      };
}

enum ReportOutcome { reported, hidden, duplicate, alreadyHidden }

/// Wire values must equal `TAKEDOWN_ROLES` in functions/src/takedown.ts.
enum TakedownRole { instructor, university, publisher, other }

extension TakedownRoleX on TakedownRole {
  String get value => switch (this) {
        TakedownRole.instructor => 'instructor',
        TakedownRole.university => 'university',
        TakedownRole.publisher => 'publisher',
        TakedownRole.other => 'other',
      };

  String get label => switch (this) {
        TakedownRole.instructor => '担当教員',
        TakedownRole.university => '大学・部局',
        TakedownRole.publisher => '出版社・著作権者',
        TakedownRole.other => 'その他の権利者',
      };
}

class ModerationException implements Exception {
  ModerationException(this.code, this.message);
  final String code;
  final String message;

  bool get isLimit => code == 'resource-exhausted';
  bool get isOwnPost => code == 'failed-precondition' && message.contains('own-post');
  bool get isNotFound => code == 'not-found';

  @override
  String toString() => 'ModerationException($code, $message)';
}

class TakedownResult {
  const TakedownResult({required this.requestId, required this.hidden, this.queued = const []});
  final String requestId;
  final List<String> hidden; // post ids the server hid at once (verified requester only)
  final List<String> queued; // existing named posts only queued for the operator (not hidden)
}

// Limits mirrored from functions/src/common.ts `MODERATION`; the server re-checks.
const int kReportMaxDetail = 500;
const int kTakedownMinDescription = 10;
const int kTakedownMaxDescription = 2000;
const int kTakedownMaxName = 100;
const int kTakedownMaxEmail = 200;

final RegExp _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

/// Null when the takedown form is acceptable, otherwise the message to show.
String? validateTakedown({required String name, required String email, required String description}) {
  final n = name.trim();
  final e = email.trim();
  final d = description.trim();
  if (n.isEmpty || n.length > kTakedownMaxName) return 'お名前（ご所属）を入力してください（100文字まで）';
  if (e.length > kTakedownMaxEmail || !_email.hasMatch(e)) return 'ご連絡先のメールアドレスを正しく入力してください';
  if (d.length < kTakedownMinDescription || d.length > kTakedownMaxDescription) {
    return '対象の資料と理由を10〜2000文字で入力してください';
  }
  return null;
}

/// Plan 2B moderation client: the `reportPost` / `submitTakedown` callables and
/// the caller's own `notifications`. The client never writes moderation state;
/// the only write is marking its own notice read (see firestore.rules).
class ModerationService {
  ModerationService(this._db, this._call);

  factory ModerationService.live(FirebaseFirestore db) => ModerationService(db, _liveInvoker);

  final FirebaseFirestore _db;
  final CallableInvoker _call;

  static Future<Map<String, dynamic>> _liveInvoker(String name, Map<String, dynamic> data) async {
    try {
      final res = await FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable(name)
          .call<Map<Object?, Object?>>(data);
      return Map<String, dynamic>.from(res.data);
    } on FirebaseFunctionsException catch (e) {
      throw ModerationException(e.code, e.message ?? e.code);
    }
  }

  Future<ReportOutcome> reportPost(String postId, ReportCategory category, String detail) async {
    final r = await _call('reportPost', {'postId': postId, 'category': category.value, 'detail': detail.trim()});
    return switch (r['status']) {
      'hidden' => ReportOutcome.hidden,
      'duplicate' => ReportOutcome.duplicate,
      'already_hidden' => ReportOutcome.alreadyHidden,
      _ => ReportOutcome.reported,
    };
  }

  Future<TakedownResult> submitTakedown({
    required List<String> postIds,
    required String requesterName,
    required TakedownRole role,
    required String contactEmail,
    required String description,
  }) async {
    final r = await _call('submitTakedown', {
      'postIds': postIds,
      'requesterName': requesterName.trim(),
      'role': role.value,
      'contactEmail': contactEmail.trim(),
      'description': description.trim(),
    });
    final hidden = r['hidden'];
    return TakedownResult(
      requestId: r['requestId'] is String ? r['requestId'] as String : '',
      hidden: hidden is List ? hidden.whereType<String>().toList() : const [],
      queued: r['queued'] is List ? (r['queued'] as List).whereType<String>().toList() : const [],
    );
  }

  /// Needs the `notifications (uid ASC, createdAt DESC)` composite index.
  Stream<List<AppNotification>> streamNotifications(String uid, {int limit = 30}) => _db
      .collection('notifications')
      .where('uid', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((q) => q.docs.map((d) => AppNotification.fromMap(d.id, d.data())).toList());

  Future<void> markNotificationRead(String id) =>
      _db.collection('notifications').doc(id).update({'read': true});
}
