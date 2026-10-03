import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/inquiry.dart';

/// お問い合わせ: a write-only mailbox (rules: create only, nobody reads).
/// Plan 3, Task 10: moved verbatim out of FirestoreService.
class InquiryRepository {
  InquiryRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  Future<void> submitInquiry(Inquiry inquiry) async {
    final data = inquiry.toMap();
    data['university_id'] = universityId;
    await _db.collection('inquiries').doc(inquiry.id).set(data);
  }
}
