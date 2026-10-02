import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';

void main() {
  test('UserProfile.toMap never writes points or an invitation code (the pending referral hint is allowed)', () {
    final m = UserProfile(uid: 'u', email: 'a@st.kyoto-u.ac.jp', displayName: 'me', createdAt: DateTime.utc(2026, 10, 3)).toMap();
    for (final k in ['points', 'invitationCode']) {
      expect(m.containsKey(k), isFalse, reason: '$k must not be client-written');
    }
  });

  test('UserProfile.toMap omits a null/empty pendingReferralCode (rules require a string)', () {
    final base = UserProfile(uid: 'u', email: 'e', displayName: 'd', createdAt: DateTime.utc(2026, 10, 3));
    expect(base.toMap().containsKey('pendingReferralCode'), isFalse);
    expect(base.copyWith(pendingReferralCode: '').toMap().containsKey('pendingReferralCode'), isFalse);
    expect(base.copyWith(pendingReferralCode: 'ABC234').toMap()['pendingReferralCode'], 'ABC234');
  });

  test('UserProfile.fromMap tolerates a legacy doc that still has them', () {
    final p = UserProfile.fromMap({'uid': 'u', 'email': 'e', 'displayName': 'd', 'points': 99, 'invitationCode': 'KU1', 'isVerified': true});
    expect(p.isVerified, isTrue);
  });
}
