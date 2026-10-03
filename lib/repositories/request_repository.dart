import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/request.dart';

/// The 資料リクエスト board (`requests`). Plan 3, Task 10: moved verbatim out of
/// FirestoreService. Fulfilment is the onPostCreated trigger's job (2A).
class RequestRepository {
  RequestRepository(this._db);
  final FirebaseFirestore _db;
  static const String universityId = 'kyoto_u';

  Future<void> createMaterialRequest(MaterialRequest req) async {
    final data = req.toMap();
    data['university_id'] = universityId;
    await _db.collection('requests').doc(req.id).set(data);
  }

  Stream<List<MaterialRequest>> streamMaterialRequests() {
    return _db
        .collection('requests')
        .where('university_id', isEqualTo: universityId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((d) => MaterialRequest.fromMap(d.data())).toList());
  }
}
