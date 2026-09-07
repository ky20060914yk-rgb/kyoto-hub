import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/subject.dart';

// best-effort courseKey — no NFKC in dart:core; Plan 2 (review aggregation by
// courseKey) must reconcile. _fold only strips whitespace + lowercases.
String _fold(String s) => s
    .replaceAll(RegExp(r'\s+'), '')
    .toLowerCase()
    .trim();

class CourseRepository {
  CourseRepository(this._db);
  final FirebaseFirestore _db;

  final Map<String, Subject> _byId = {};
  bool _loaded = false;
  Future<void>? _loading;

  Subject _fromDoc(Map<String, dynamic> m) => Subject(
        id: m['id'] as String,
        name: (m['name'] ?? '') as String,
        faculty: (m['faculty'] ?? '全学共通') as String,
        dayOfWeek: (m['dayOfWeek'] ?? 'Mon') as String,
        period: (m['period'] ?? 1) as int,
        lecturer: (m['lecturer'] ?? '') as String,
        category: (m['category'] ?? '専門/教養') as String,
        courseKey: (m['courseKey'] ?? '') as String,
      );

  Future<void> warmUp() {
    if (_loaded) return Future.value();
    return _loading ??= _load();
  }

  Future<void> _load() async {
    try {
      final snap = await _db
          .collection('courses')
          .where('university_id', isEqualTo: 'kyoto_u')
          .get();
      _byId
        ..clear()
        ..addEntries(snap.docs.map((d) {
          final s = _fromDoc(d.data());
          return MapEntry(s.id, s);
        }));
      _loaded = true;
    } finally {
      // Always release the in-flight future so a failed cold load is
      // retryable; _loaded stays false on failure, so the next warmUp()
      // starts a fresh attempt instead of replaying a rejected future.
      _loading = null;
    }
  }

  Future<List<Subject>> search(String query, {int limit = 50}) async {
    await warmUp();
    final q = _fold(query);
    if (q.isEmpty) return const [];
    final hits = _byId.values.where((s) =>
        _fold(s.name).contains(q) ||
        _fold(s.lecturer).contains(q) ||
        _fold(s.faculty).contains(q));
    return hits.take(limit).toList()
      ..sort((a, b) => a.name.compareTo(b.name));
  }

  Future<List<Subject>> forSlot(String day, int period) async {
    await warmUp();
    return _byId.values
        .where((s) => s.dayOfWeek == day && s.period == period)
        .toList()
      ..sort((a, b) => a.name.compareTo(b.name));
  }

  Future<Subject?> byId(String id) async {
    // Warm the whole catalog first: resolving a 25-cell timetable one doc at a
    // time would otherwise be 25 sequential round-trips on a cold start.
    await warmUp();
    if (_byId.containsKey(id)) return _byId[id];
    // Genuine cache miss (dangling id, or a doc written after the warm-up).
    final doc = await _db.collection('courses').doc(id).get();
    if (!doc.exists) return null;
    final s = _fromDoc(doc.data()!);
    _byId[s.id] = s;
    return s;
  }

  // best-effort courseKey — no NFKC in dart:core; Plan 2 (review aggregation by
  // courseKey) must reconcile. A hand-added course's key may not match a catalog
  // course's key for names containing full-width characters.
  Future<Subject> addCustomCourse({
    required String name,
    required String faculty,
    required String dayOfWeek,
    required int period,
    required String lecturer,
    String category = '専門/教養',
  }) async {
    final courseKey = '${_fold(name)}|${_fold(lecturer)}';
    final id = 'c_custom_${DateTime.now().millisecondsSinceEpoch}';
    final data = {
      'id': id,
      'courseKey': courseKey,
      'name': name,
      'faculty': faculty,
      'lecturer': lecturer,
      'dayOfWeek': dayOfWeek,
      'period': period,
      'category': category,
      'university_id': 'kyoto_u',
    };
    await _db.collection('courses').doc(id).set(data);
    final s = _fromDoc(data);
    _byId[id] = s;
    return s;
  }
}
