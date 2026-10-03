import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:kyoto_exam_hub/models/user_profile.dart';
import 'package:kyoto_exam_hub/repositories/course_repository.dart';
import 'package:kyoto_exam_hub/services/app_store.dart';
import 'package:kyoto_exam_hub/services/credit_service.dart';
import 'package:kyoto_exam_hub/services/market_service.dart';
import 'package:kyoto_exam_hub/services/moderation_service.dart';
import 'package:kyoto_exam_hub/services/ranking_service.dart';
import 'package:kyoto_exam_hub/services/review_service.dart';

/// An AppStore on fake_cloud_firestore (Plan 3, Task 9). Every Firestore call
/// goes to [db]; every callable to [calls] (answered by [reply]); FirebaseAuth
/// is never touched (it is resolved lazily and the constructor's sync swallows
/// its absence). Shared by the characterization and widget tests.
class Harness {
  Harness() {
    store = AppStore(
      CourseRepository(db),
      ReviewService(db),
      RankingService(db),
      CreditService(db, _invoke),
      ModerationService(db, _invoke),
      db: db,
      market: MarketService(db, _invoke),
    );
  }

  final FakeFirebaseFirestore db = FakeFirebaseFirestore();
  late final AppStore store;
  final List<(String, Map<String, dynamic>)> calls = [];
  Map<String, dynamic> Function(String name, Map<String, dynamic> data) reply = (_, _) => {};

  Future<Map<String, dynamic>> _invoke(String name, Map<String, dynamic> data) async {
    calls.add((name, data));
    return reply(name, data);
  }

  void signIn({String uid = 'u1', bool verified = true, String name = '京大生_1234'}) {
    store.currentUser = UserProfile(
      uid: uid,
      email: '$uid@st.kyoto-u.ac.jp',
      displayName: name,
      createdAt: DateTime(2026, 4, 1),
      isVerified: verified,
    );
  }

  Future<void> seedCourse(String id, String name) => db.collection('courses').doc(id).set({
        'id': id, 'name': name, 'faculty': '全学共通', 'dayOfWeek': 'Mon', 'period': 1,
        'lecturer': '山田', 'courseKey': '$name|山田', 'university_id': 'kyoto_u',
      });
}
