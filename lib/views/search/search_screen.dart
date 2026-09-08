import 'dart:async';

import 'package:flutter/material.dart';

import '../../models/course_stats.dart';
import '../../models/subject.dart';
import '../../services/app_store.dart';
import '../../services/ranking_service.dart';
import '../course/course_detail_screen.dart';

/// The さがす tab: course search + a faculty filter + four client-side rankings.
///
/// The nav shell owns the unverified banner; this screen has its own plain
/// [AppBar]. When the search field holds a non-empty trimmed query the ranking
/// sections are hidden and the (debounced) catalog search results take over.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

const _brand = Color(0xFF0F4C81);

/// The catalog is ~99% 全学共通 today, so most chips are sparse — but the list
/// is stable, so it is a `const` rather than derived from the loaded catalog.
const _faculties = <String>[
  'すべて',
  '全学共通',
  '工学部',
  '法学部',
  '経済学部',
  '文学部',
  '理学部',
  '農学部',
  '医学部/薬学部',
  '総合人間学部',
  '教育学部',
];

const _rankingTitles = <RankingKind, String>{
  RankingKind.rakutan: '楽単ランキング',
  RankingKind.mostReviewed: 'レビューが多い科目',
  RankingKind.mostPastExams: '過去問が多い科目',
  RankingKind.recentlyReviewed: '新着レビュー',
};

class _SearchScreenState extends State<SearchScreen> {
  final _searchController = TextEditingController();
  static const _debounceDelay = Duration(milliseconds: 250);
  // Without the debounce every keystroke runs a full scan of the ~10k-course
  // catalog (mirrors HomeScreen).
  Timer? _debounce;

  String _query = '';
  List<Subject> _results = [];
  bool _searching = false;
  bool _searchFailed = false;
  // Monotonic guard: a slow earlier keystroke's result must not overwrite a
  // newer one (mirrors HomeScreen._searchSeq).
  int _searchSeq = 0;

  String _faculty = 'すべて';

  // Assigned ONCE in initState (and reassigned only by pull-to-refresh). The
  // Future objects must be stable across build() so a rebuild never refetches —
  // hence a plain field, not `late final`, and never created in build().
  late Map<RankingKind, Future<List<CourseStats>>> _rankings;

  @override
  void initState() {
    super.initState();
    _rankings = {
      for (final k in RankingKind.values) k: widget.store.ranking.ranking(k),
    };
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  /// Re-arms the debounce. An empty trimmed query is applied immediately so
  /// clearing the box never leaves stale results (and the rankings) hidden.
  void _onQueryChanged(String raw) {
    final q = raw.trim();
    _debounce?.cancel();
    if (q.isEmpty) {
      // Bump the seq so any in-flight search can't land after the clear.
      _searchSeq++;
      setState(() {
        _query = '';
        _results = [];
        _searching = false;
        _searchFailed = false;
      });
      return;
    }
    setState(() {
      _query = q;
      _searching = true;
      _searchFailed = false;
    });
    _debounce = Timer(_debounceDelay, () => _runSearch(q));
  }

  Future<void> _runSearch(String q) async {
    final seq = ++_searchSeq;
    if (mounted) {
      setState(() {
        _searching = true;
        _searchFailed = false;
      });
    }
    try {
      final results = await widget.store.courses.search(q);
      if (!mounted || seq != _searchSeq) return;
      setState(() {
        _results = results;
        _searching = false;
      });
    } catch (_) {
      if (!mounted || seq != _searchSeq) return;
      setState(() {
        _results = [];
        _searching = false;
        _searchFailed = true;
      });
    }
  }

  Future<void> _refresh() async {
    widget.store.ranking.invalidate();
    setState(() {
      _rankings = {
        for (final k in RankingKind.values) k: widget.store.ranking.ranking(k),
      };
    });
  }

  bool _matchesFaculty(String faculty) =>
      _faculty == 'すべて' || faculty == _faculty;

  void _openCourse(Subject sub) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CourseDetailScreen(store: widget.store, subject: sub),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final showRankings = _query.isEmpty;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: const Text(
          'さがす',
          style: TextStyle(
            color: Color(0xFF1E293B),
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
      body: RefreshIndicator(
        color: _brand,
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            _buildSearchField(),
            const SizedBox(height: 12),
            _buildFacultyFilter(),
            const SizedBox(height: 16),
            if (showRankings)
              ..._buildRankingSections()
            else
              ..._buildSearchResults(),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchField() {
    return TextField(
      controller: _searchController,
      onChanged: _onQueryChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: '科目名・教員名で検索',
        hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
        prefixIcon: const Icon(Icons.search, color: _brand),
        suffixIcon: _query.isNotEmpty
            ? IconButton(
                icon: const Icon(Icons.clear, size: 18),
                onPressed: () {
                  _searchController.clear();
                  _onQueryChanged('');
                },
              )
            : null,
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _brand, width: 1.5),
        ),
      ),
    );
  }

  Widget _buildFacultyFilter() {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _faculties.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final f = _faculties[i];
          return ChoiceChip(
            label: Text(f, style: const TextStyle(fontSize: 12)),
            selected: _faculty == f,
            selectedColor: _brand.withAlpha(30),
            onSelected: (_) => setState(() => _faculty = f),
          );
        },
      ),
    );
  }

  // --- Search results -------------------------------------------------------

  List<Widget> _buildSearchResults() {
    if (_searching) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    if (_searchFailed) {
      return [_inlineError(() => _runSearch(_query))];
    }
    final filtered = _results.where((s) => _matchesFaculty(s.faculty)).toList();
    if (filtered.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 32),
          child: Center(
            child: Text(
              '該当する科目がみつかりませんでした',
              style: TextStyle(color: Color(0xFF94A3B8)),
            ),
          ),
        ),
      ];
    }
    return [
      for (final sub in filtered)
        Card(
          margin: const EdgeInsets.only(bottom: 8),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: const BorderSide(color: Color(0xFFE2E8F0)),
          ),
          child: ListTile(
            title: Text(
              sub.name,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
            ),
            subtitle: Text(
              '${sub.faculty} • ${sub.timeSlotLabel} • ${sub.lecturer}',
            ),
            trailing: const Icon(Icons.chevron_right_rounded, color: _brand),
            onTap: () => _openCourse(sub),
          ),
        ),
    ];
  }

  // --- Rankings -----------------------------------------------------------

  List<Widget> _buildRankingSections() {
    final widgets = <Widget>[];
    for (final kind in RankingKind.values) {
      widgets.add(
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 8),
          child: Text(
            _rankingTitles[kind]!,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1E293B),
            ),
          ),
        ),
      );
      widgets.add(
        FutureBuilder<List<CourseStats>>(
          future: _rankings[kind],
          builder: (context, snap) {
            if (snap.hasError) {
              // Not a spinner forever, not a misleading empty state.
              return _inlineError(_refresh);
            }
            if (snap.connectionState == ConnectionState.waiting) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  ),
                ),
              );
            }
            // Resolve each courseKey to a catalog Subject; skip stale docs and
            // apply the faculty filter. The fetch caps at 30; 10 rows is plenty.
            final rows = <_RankRow>[];
            for (final cs in snap.data ?? const <CourseStats>[]) {
              final sub = widget.store.courses.byCourseKey(cs.courseKey);
              if (sub == null) continue;
              if (!_matchesFaculty(sub.faculty)) continue;
              rows.add(_RankRow(cs, sub));
              if (rows.length >= 10) break;
            }
            if (rows.isEmpty) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  'まだ十分なデータがありません',
                  style: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                ),
              );
            }
            return Column(
              children: [
                for (var i = 0; i < rows.length; i++)
                  _rankingRow(i + 1, kind, rows[i].stats, rows[i].subject),
              ],
            );
          },
        ),
      );
      widgets.add(const SizedBox(height: 16));
    }
    return widgets;
  }

  Widget _rankingRow(int rank, RankingKind kind, CourseStats cs, Subject sub) {
    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: ListTile(
        dense: true,
        leading: SizedBox(
          width: 24,
          child: Text(
            '$rank',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
              color: _brand,
            ),
          ),
        ),
        title: Text(
          sub.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
        ),
        subtitle: Text(
          '${sub.faculty} • ${sub.lecturer}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: _metricBadge(kind, cs),
        onTap: () => _openCourse(sub),
      ),
    );
  }

  Widget _metricBadge(RankingKind kind, CourseStats cs) {
    final String text;
    final Color color;
    switch (kind) {
      case RankingKind.rakutan:
        text = '楽単 ${cs.score}';
        color = cs.score >= 66
            ? const Color(0xFF10B981)
            : cs.score >= 33
                ? const Color(0xFFF59E0B)
                : const Color(0xFFEF4444);
      case RankingKind.mostReviewed:
        text = 'レビュー${cs.reviewCount}';
        color = _brand;
      case RankingKind.mostPastExams:
        text = '過去問${cs.pastExamPostCount}';
        color = _brand;
      case RankingKind.recentlyReviewed:
        text = _relativeDate(cs.lastReviewAt);
        color = const Color(0xFF64748B);
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(24),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.bold,
          color: color,
        ),
      ),
    );
  }

  Widget _inlineError(VoidCallback onRetry) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.cloud_off_rounded, size: 18, color: Color(0xFF94A3B8)),
          const SizedBox(width: 8),
          const Flexible(
            child: Text(
              '読み込みに失敗しました',
              style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(foregroundColor: _brand),
            child: const Text('再試行', style: TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }

  static String _relativeDate(DateTime? d) {
    if (d == null) return '—';
    final diff = DateTime.now().difference(d);
    if (diff.inDays >= 365) return '${(diff.inDays / 365).floor()}年前';
    if (diff.inDays >= 30) return '${(diff.inDays / 30).floor()}ヶ月前';
    if (diff.inDays >= 1) return '${diff.inDays}日前';
    if (diff.inHours >= 1) return '${diff.inHours}時間前';
    if (diff.inMinutes >= 1) return '${diff.inMinutes}分前';
    return 'たった今';
  }
}

class _RankRow {
  const _RankRow(this.stats, this.subject);
  final CourseStats stats;
  final Subject subject;
}
