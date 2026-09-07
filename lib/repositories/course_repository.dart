import 'dart:async';

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

  /// Pre-folded `name lecturer faculty` per course id (I5). Folding is a
  /// RegExp replace, and `search()` runs on every keystroke — folding 10k
  /// course names per character is the difference between a responsive search
  /// box and a locked-up tab. The query side still goes through `_fold`.
  final Map<String, String> _haystack = {};

  /// Ids we have already looked up and found missing (M2). A dangling id left
  /// in a timetable would otherwise cost one Firestore read on every single
  /// `_refreshRegistered()`.
  final Set<String> _missing = {};

  bool _loaded = false;
  Future<void>? _loading;

  /// The `meta/catalog.version` the in-memory catalog was loaded at. Used to
  /// decide whether the on-device Firestore cache is stale.
  int? _catalogVersion;

  /// Builds a [Subject] from a raw document, or null when the document is not
  /// usable at all (C1).
  ///
  /// This is deliberately total: the previous version cast `id` and `period`
  /// unconditionally, so a single malformed document — one written before the
  /// rules validated the course shape, say — threw out of `_load()` and took
  /// the *entire* catalog with it. Only a missing/empty `name` is fatal now;
  /// everything else falls back, with `id` defaulting to the document id.
  Subject? _fromDoc(String docId, Map<String, dynamic> m) {
    final name = m['name'];
    if (name is! String || name.isEmpty) return null;
    final p = m['period'];
    return Subject(
      id: (m['id'] is String && (m['id'] as String).isNotEmpty) ? m['id'] as String : docId,
      name: name,
      faculty: m['faculty'] is String ? m['faculty'] as String : '全学共通',
      dayOfWeek: m['dayOfWeek'] is String ? m['dayOfWeek'] as String : 'Mon',
      period: p is int ? p : (p is num ? p.toInt() : 1),
      lecturer: m['lecturer'] is String ? m['lecturer'] as String : '',
      category: m['category'] is String ? m['category'] as String : '専門/教養',
      courseKey: m['courseKey'] is String ? m['courseKey'] as String : '',
    );
  }

  void _remember(Subject s) {
    _byId[s.id] = s;
    _haystack[s.id] = '${_fold(s.name)} ${_fold(s.lecturer)} ${_fold(s.faculty)}';
    _missing.remove(s.id);
  }

  Query<Map<String, dynamic>> _query() =>
      _db.collection('courses').where('university_id', isEqualTo: 'kyoto_u');

  Future<void> warmUp() {
    if (_loaded) return Future.value();
    return _loading ??= _load();
  }

  /// Reads `meta/catalog.version` (one document read per cold start). A version
  /// that differs from the one this session last loaded means the seeded
  /// catalog changed, so the on-device cache must be bypassed.
  ///
  /// `tools/seed_courses.mjs` bumps `meta/catalog.version` after every seed —
  /// without that bump, a client that already has the old catalog cached would
  /// keep serving it for the life of the install.
  Future<int?> _remoteCatalogVersion() async {
    try {
      final meta = await _db.collection('meta').doc('catalog').get();
      final v = meta.data()?['version'];
      if (v is int) return v;
      if (v is num) return v.toInt();
      return null;
    } catch (_) {
      // The staleness check is advisory: a missing or unreadable `meta/catalog`
      // must never stop the catalog itself from loading.
      return null;
    }
  }

  Future<void> _load() async {
    try {
      final remoteVersion = await _remoteCatalogVersion();
      final stale = remoteVersion != null && remoteVersion != _catalogVersion;

      // Cache-first (C3). The Spark plan allows 50k document reads per day
      // *project-wide*; a full 10k-document server fetch on every session would
      // exhaust that after five visitors. The server is only consulted when the
      // cache has nothing, or when meta/catalog says the catalog moved on.
      QuerySnapshot<Map<String, dynamic>>? snap;
      if (!stale) {
        try {
          snap = await _query().get(const GetOptions(source: Source.cache));
        } catch (_) {
          snap = null;
        }
      }
      if (snap == null || snap.docs.isEmpty) {
        snap = await _query().get(const GetOptions(source: Source.server));
      }

      // An empty catalog is a failure, not a valid state (I6): latching
      // `_loaded = true` on it would leave the app permanently showing "no
      // courses" with no way back. Throwing keeps `_loaded` false so the home
      // screen's error card and its 再試行 button can drive a fresh attempt.
      if (snap.docs.isEmpty) {
        throw StateError('empty catalog');
      }

      _byId.clear();
      _haystack.clear();
      _missing.clear();
      for (final d in snap.docs) {
        final s = _fromDoc(d.id, d.data());
        // A malformed document is skipped, not fatal (C1).
        if (s != null) _remember(s);
      }
      _catalogVersion = remoteVersion;
      _loaded = true;
    } finally {
      // Always release the in-flight future so a failed cold load is
      // retryable; _loaded stays false on failure, so the next warmUp()
      // starts a fresh attempt instead of replaying a rejected future.
      _loading = null;
    }
  }

  /// Case/space-insensitive substring search over name, lecturer and faculty.
  ///
  /// The full match set is sorted *before* truncation (I1) — truncating first
  /// returned an arbitrary 50 of the matches and then sorted only those, so the
  /// alphabetically-first course was usually missing. `result.length == limit`
  /// is the caller's "capped" signal.
  Future<List<Subject>> search(String query, {int limit = 500}) async {
    await warmUp();
    final q = _fold(query);
    if (q.isEmpty) return const [];
    final hits = <Subject>[];
    for (final entry in _byId.entries) {
      if (_haystack[entry.key]?.contains(q) ?? false) hits.add(entry.value);
    }
    hits.sort((a, b) => a.name.compareTo(b.name));
    return hits.length > limit ? hits.sublist(0, limit) : hits;
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
    // Negative cache (M2): a dangling timetable id must not cost a Firestore
    // read on every single refresh.
    if (_missing.contains(id)) return null;
    // Genuine cache miss (dangling id, or a doc written after the warm-up).
    final doc = await _db.collection('courses').doc(id).get();
    final data = doc.data();
    final s = doc.exists && data != null ? _fromDoc(doc.id, data) : null;
    if (s == null) {
      _missing.add(id);
      return null;
    }
    _remember(s);
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
    final data = <String, dynamic>{
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
    // The shape above is exactly what the `courses` create rule demands (C1):
    // `id` equal to the document id, an int `period` in 1..5, a weekday
    // `dayOfWeek`, and string `lecturer`/`faculty`/`courseKey`.
    //
    // Fire-and-forget (C4): the local entry below is what the UI shows, and an
    // unverified student's write is rejected by the rules. Awaiting the
    // server-ack would hang the "add subject" modal behind a write that is
    // never going to land, or behind a slow connection.
    unawaited(_db.collection('courses').doc(id).set(data).catchError((_) {}));
    final s = _fromDoc(id, data)!;
    _remember(s);
    return s;
  }
}
