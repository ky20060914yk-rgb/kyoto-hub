import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
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

  /// Lookup map from courseKey to Subject for ranking row joins (Plan B, さがす).
  final Map<String, Subject> _byCourseKey = {};

  bool _loaded = false;
  Future<void>? _loading;

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
    if (s.courseKey.isNotEmpty) _byCourseKey.putIfAbsent(s.courseKey, () => s);
  }

  Query<Map<String, dynamic>> _query() =>
      _db.collection('courses').where('university_id', isEqualTo: 'kyoto_u');

  Future<void> warmUp() {
    if (_loaded) return Future.value();
    return _loading ??= _load();
  }

  /// Reads `meta/catalog.courseCount` — the number of course documents the last
  /// seed wrote (one document read per cold start).
  ///
  /// `tools/seed_courses.mjs` writes `{ version, courseCount }` after every
  /// seed. `courseCount` is the authoritative catalog size; the client compares
  /// it against the size of its own cached snapshot to decide whether the cache
  /// is complete and current.
  Future<int?> _remoteCatalogCount() async {
    try {
      final meta = await _db.collection('meta').doc('catalog').get();
      final c = meta.data()?['courseCount'];
      if (c is int) return c;
      if (c is num) return c.toInt();
      return null;
    } catch (_) {
      // The staleness check is advisory: a missing or unreadable `meta/catalog`
      // must never stop the catalog itself from loading.
      return null;
    }
  }

  /// Whether an on-device cache snapshot holding [cachedLen] documents may be
  /// served without a server round-trip.
  ///
  /// The decision is **count-based** on purpose. The previous version compared
  /// `meta/catalog.version` against an in-memory field that was null on every
  /// cold start, so the "stale" branch always won and every session ran the
  /// full ~10k-document `Source.server` fetch — enough to blow through the
  /// Spark plan's 50k-reads/day *project-wide* quota after a handful of
  /// visitors. Both operands here are recomputed from durable state each call
  /// (the cached snapshot's own size, and the seeded count), so the answer
  /// survives a page reload.
  ///
  /// A null [authoritativeCount] means `meta/catalog` was missing or unreadable
  /// — we cannot vouch for the cache and must read the server.
  ///
  /// Exposed for unit testing because `fake_cloud_firestore` does not
  /// distinguish `Source.cache` from `Source.server`, so the cache/server
  /// branch cannot be exercised through `_load()` in tests.
  @visibleForTesting
  static bool cacheIsFresh(int cachedLen, int? authoritativeCount) =>
      authoritativeCount != null &&
      cachedLen > 0 &&
      cachedLen == authoritativeCount;

  Future<void> _load() async {
    try {
      final authoritativeCount = await _remoteCatalogCount();

      // Cache-first (C3). The Spark plan allows 50k document reads per day
      // *project-wide*; a full 10k-document server fetch on every session would
      // exhaust that after five visitors. The cached snapshot is served only
      // when it is non-empty AND exactly the size meta/catalog says the seeded
      // catalog is; anything else falls through to the server.
      QuerySnapshot<Map<String, dynamic>>? snap;
      try {
        final cached =
            await _query().get(const GetOptions(source: Source.cache));
        if (cacheIsFresh(cached.docs.length, authoritativeCount)) {
          snap = cached;
        }
      } catch (_) {
        // No usable on-device cache (first run, evicted, or unsupported).
      }
      snap ??= await _query().get(const GetOptions(source: Source.server));

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
      _byCourseKey.clear();
      for (final d in snap.docs) {
        final s = _fromDoc(d.id, d.data());
        // A malformed document is skipped, not fatal (C1).
        if (s != null) _remember(s);
      }
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

  /// Synchronous courseKey → Subject lookup for ranking row joins (Plan B).
  /// Returns any one cached Subject whose courseKey matches, or null if the
  /// catalog isn't warm or no match exists. The catalog has several Subjects
  /// per courseKey (one per slot); the first one wins for display purposes.
  Subject? byCourseKey(String courseKey) => _byCourseKey[courseKey];

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
