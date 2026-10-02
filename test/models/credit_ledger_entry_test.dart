import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/credit_ledger_entry.dart';

void main() {
  test('parses a Function-written ledger row (Timestamp createdAt)', () {
    final e = CreditLedgerEntry.fromMap('dl_u_p', {
      'uid': 'u', 'delta': -1, 'reason': 'download', 'refId': 'p', 'balanceAfter': 2,
      'createdAt': Timestamp.fromDate(DateTime.utc(2026, 10, 3, 9)),
    });
    expect(e.id, 'dl_u_p');
    expect(e.delta, -1);
    expect(e.reason, 'download');
    expect(e.refId, 'p');
    expect(e.balanceAfter, 2);
    expect(e.createdAt.toUtc(), DateTime.utc(2026, 10, 3, 9));
  });

  test('is total: garbage fields degrade instead of throwing', () {
    final e = CreditLedgerEntry.fromMap('x', {
      'delta': 'many', 'reason': 7, 'balanceAfter': double.nan, 'createdAt': {'oops': 1},
    });
    expect(e.delta, 0);
    expect(e.reason, '');
    expect(e.balanceAfter, 0);
    expect(e.createdAt, DateTime.fromMillisecondsSinceEpoch(0));
  });

  test('accepts an ISO-8601 createdAt string', () {
    final e = CreditLedgerEntry.fromMap('x', {'delta': 1, 'reason': 'upload', 'createdAt': '2026-10-03T00:00:00.000Z'});
    expect(e.createdAt.toUtc(), DateTime.utc(2026, 10, 3));
  });

  test('label maps every server reason to Japanese copy, unknown reasons fall back', () {
    const expected = {
      'signup_bonus': 'ご登録ボーナス',
      'upload': '資料のアップロード',
      'download': '資料のダウンロード',
      'download_free': '資料のダウンロード（無料）',
      'first_review': 'レビュー投稿ボーナス（最初の3件）',
      'scarce_review': 'レビューの少ない科目への投稿',
      'request_fulfilled': 'リクエストへの対応',
      'referral_in': '招待コード特典',
      'referral_out': 'ご友人の招待特典',
    };
    expected.forEach((reason, label) {
      expect(CreditLedgerEntry.fromMap('x', {'reason': reason}).label, label);
    });
    expect(CreditLedgerEntry.fromMap('x', {'reason': 'mystery'}).label, 'クレジットの増減');
  });
}
