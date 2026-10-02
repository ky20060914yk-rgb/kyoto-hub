import 'package:cloud_firestore/cloud_firestore.dart';

/// One row of `credits_ledger`, written only by Cloud Functions. The reader is
/// total: a malformed row degrades to zeros rather than crashing the マイページ.
class CreditLedgerEntry {
  final String id;
  final int delta;
  final String reason;
  final String? refId;
  final int balanceAfter;
  final DateTime createdAt;

  const CreditLedgerEntry({
    required this.id,
    required this.delta,
    required this.reason,
    this.refId,
    required this.balanceAfter,
    required this.createdAt,
  });

  String get label => switch (reason) {
        'signup_bonus' => 'ご登録ボーナス',
        'upload' => '資料のアップロード',
        'download' => '資料のダウンロード',
        'download_free' => '資料のダウンロード（無料）',
        'first_review' => 'レビュー投稿ボーナス（最初の3件）',
        'scarce_review' => 'レビューの少ない科目への投稿',
        'request_fulfilled' => 'リクエストへの対応',
        'referral_in' => '招待コード特典',
        'referral_out' => 'ご友人の招待特典',
        _ => 'クレジットの増減',
      };

  static int _int(dynamic v) => (v is num && v.isFinite) ? v.toInt() : 0;

  static DateTime _time(dynamic v) {
    if (v is Timestamp) return v.toDate();
    if (v is String) return DateTime.tryParse(v) ?? DateTime.fromMillisecondsSinceEpoch(0);
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  factory CreditLedgerEntry.fromMap(String id, Map<String, dynamic> map) {
    return CreditLedgerEntry(
      id: id,
      delta: _int(map['delta']),
      reason: map['reason'] is String ? map['reason'] as String : '',
      refId: map['refId'] is String ? map['refId'] as String : null,
      balanceAfter: _int(map['balanceAfter']),
      createdAt: _time(map['createdAt']),
    );
  }
}
