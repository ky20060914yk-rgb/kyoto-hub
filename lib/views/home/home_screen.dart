import '../../widgets/credit_rules_dialog.dart';
import 'dart:async';

import 'package:flutter/foundation.dart' show setEquals;
import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../../models/subject.dart';
import '../course/course_detail_screen.dart';
import '../timetable/timetable_registration_screen.dart';

class HomeScreen extends StatefulWidget {
  final AppStore store;

  const HomeScreen({super.key, required this.store});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  bool _isGridView = true;
  bool _isTransposed = false;

  final List<String> _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  final List<String> _dayLabels = ['月', '火', '水', '木', '金'];
  final List<int> _periods = [1, 2, 3, 4, 5];

  // Courses are loaded asynchronously from Firestore via CourseRepository.
  List<Subject> _registeredSubjects = [];
  Map<String, Subject> _registeredById = {};
  bool _loadingTimetable = true;
  String? _timetableError;
  int _timetableSeq = 0;
  // The set of course ids the last refresh was started for. Used to decide
  // whether an AppStore notification actually changed the timetable.
  Set<String> _lastTimetableIds = {};

  List<Subject> _searchResults = [];
  bool _isSearching = false;
  int _searchSeq = 0;
  String? _searchError;
  // Keystroke debounce (I5): without it every character runs a full scan of the
  // ~10k-course catalog.
  Timer? _searchDebounce;
  static const _searchDebounceDelay = Duration(milliseconds: 200);
  // Mirrors CourseRepository.search's default limit: a result list exactly this
  // long has been capped, so the count is rendered as "N件以上" (I1).
  static const _searchLimit = 500;

  @override
  void initState() {
    super.initState();
    // HomeScreen is held behind a GlobalKey, so initState runs once. The store
    // may populate userTimetable *after* we mount (Firestore sync), so listen
    // for changes instead of relying on load ordering.
    widget.store.addListener(_onStoreChanged);
    _refreshRegistered();
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreChanged);
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  /// Re-arms the debounce timer. An empty query is applied immediately so
  /// clearing the box never leaves stale results on screen.
  void _scheduleSearch(String query) {
    _searchDebounce?.cancel();
    if (query.isEmpty) {
      _runSearch('');
      return;
    }
    setState(() {
      _isSearching = true;
      _searchError = null;
    });
    _searchDebounce = Timer(_searchDebounceDelay, () => _runSearch(query));
  }

  Set<String> _currentTimetableIds() =>
      widget.store.userTimetable.values.toSet();

  void _onStoreChanged() {
    // Only refetch when the registered course ids actually changed — the store
    // notifies for many unrelated reasons (credits, posts, requests…).
    if (setEquals(_currentTimetableIds(), _lastTimetableIds)) return;
    _refreshRegistered();
  }

  Future<void> _refreshRegistered() async {
    final seq = ++_timetableSeq;
    // Recorded up-front (success *and* failure) so a persistent failure cannot
    // turn every store notification into another refresh attempt.
    _lastTimetableIds = _currentTimetableIds();
    setState(() {
      _loadingTimetable = true;
      _timetableError = null;
    });
    try {
      final list = await widget.store.getRegisteredSubjects();
      if (!mounted || seq != _timetableSeq) return;
      setState(() {
        _registeredSubjects = list;
        _registeredById = {for (final s in list) s.id: s};
      });
    } catch (_) {
      if (!mounted || seq != _timetableSeq) return;
      setState(() {
        _timetableError = '時間割の読み込みに失敗しました。通信環境を確認して再試行してください。';
      });
    } finally {
      if (mounted && seq == _timetableSeq) {
        setState(() => _loadingTimetable = false);
      }
    }
  }

  Future<void> _runSearch(String query) async {
    final seq = ++_searchSeq;
    if (query.isEmpty) {
      setState(() {
        _searchResults = [];
        _isSearching = false;
        _searchError = null;
      });
      return;
    }
    setState(() {
      _isSearching = true;
      _searchError = null;
    });
    try {
      final results = await widget.store.courses.search(query, limit: _searchLimit);
      if (!mounted || seq != _searchSeq) return;
      setState(() => _searchResults = results);
    } catch (_) {
      if (!mounted || seq != _searchSeq) return;
      setState(() {
        _searchResults = [];
        _searchError = '検索に失敗しました。通信環境を確認して再試行してください。';
      });
    } finally {
      if (mounted && seq == _searchSeq) {
        setState(() => _isSearching = false);
      }
    }
  }

  Widget _buildErrorCard(String message, VoidCallback onRetry) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        children: [
          const Icon(Icons.cloud_off_rounded, size: 36, color: Color(0xFFCBD5E1)),
          const SizedBox(height: 8),
          const Text('読み込みに失敗しました', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
          const SizedBox(height: 4),
          Text(
            message,
            style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('再試行', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0F4C81),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
        ],
      ),
    );
  }

  void _openOnboardingEditor() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => TimetableRegistrationScreen(store: widget.store, isOnboarding: false),
      ),
    ).then((_) {
      _refreshRegistered();
    });
  }

  void _showDirectRegisterDialog(Subject subject) {
    String selectedDay = 'Mon';
    int selectedPeriod = 1;
    final days = {'Mon': '月曜', 'Tue': '火曜', 'Wed': '水曜', 'Thu': '木曜', 'Fri': '金曜'};
    final periods = [1, 2, 3, 4, 5];

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Text('時間割に登録', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('『${subject.name}』を時間割のどのコマに登録しますか？', style: const TextStyle(fontSize: 13, color: Color(0xFF475569))),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: selectedDay,
                          decoration: const InputDecoration(labelText: '曜日', border: OutlineInputBorder()),
                          items: days.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
                          onChanged: (val) {
                            if (val != null) setDialogState(() => selectedDay = val);
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: DropdownButtonFormField<int>(
                          value: selectedPeriod,
                          decoration: const InputDecoration(labelText: '時限', border: OutlineInputBorder()),
                          items: periods.map((p) => DropdownMenuItem(value: p, child: Text('$p限'))).toList(),
                          onChanged: (val) {
                            if (val != null) setDialogState(() => selectedPeriod = val);
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              actions: [
                TextButton(
                  child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
                  onPressed: () => Navigator.pop(context),
                ),
                TextButton(
                  child: const Text('登録する', style: TextStyle(color: Color(0xFF0F4C81), fontWeight: FontWeight.bold)),
                  onPressed: () {
                    widget.store.registerTimetableSubject(selectedDay, selectedPeriod, subject.id);
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('『${subject.name}』を時間割に登録しました。')),
                    );
                    _refreshRegistered();
                  },
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: const Color(0xFF0F4C81).withAlpha(20),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.school_rounded, color: Color(0xFF0F4C81), size: 20),
            ),
            const SizedBox(width: 10),
            const Text(
              '京大InfoHub',
              style: TextStyle(color: Color(0xFF1E293B), fontWeight: FontWeight.bold, fontSize: 18),
            ),
          ],
        ),
        actions: [
          GestureDetector(
            onTap: () => showCreditRulesDialog(context),
            child: Container(
              margin: const EdgeInsets.only(right: 16),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Color(0xFF0F4C81), Color(0xFF1E5B94)]),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                children: [
                  const Icon(Icons.stars_rounded, color: Color(0xFFFBBF24), size: 16),
                  const SizedBox(width: 4),
                  Text(
                    '${widget.store.creditBalance} クレジット',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.help_outline_rounded, color: Colors.white70, size: 13),
                ],
              ),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Search Bar
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(color: Colors.black.withAlpha(8), blurRadius: 10, offset: const Offset(0, 2)),
                ],
              ),
              child: TextField(
                controller: _searchController,
                onChanged: (val) {
                  setState(() {
                    _searchQuery = val.trim();
                  });
                  _scheduleSearch(_searchQuery);
                },
                decoration: InputDecoration(
                  hintText: '科目名・教員名・学部で検索 (未登録科目も可能)',
                  hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                  prefixIcon: const Icon(Icons.search_rounded, color: Color(0xFF0F4C81)),
                  suffixIcon: _searchQuery.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, size: 18),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {
                              _searchQuery = '';
                            });
                            _scheduleSearch('');
                          },
                        )
                      : null,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Main Content Area
            if (_searchQuery.isNotEmpty)
              _buildSearchResults(_searchResults)
            else if (_loadingTimetable)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_timetableError != null)
              _buildErrorCard(_timetableError!, _refreshRegistered)
            else
              _buildRegisteredTimetableGrid(_registeredSubjects),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchResults(List<Subject> searchResults) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('全KULASIS科目からの検索結果', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(width: 8),
            // `length == limit` is CourseRepository.search's "capped" signal (I1).
            Text(
              searchResults.length >= _searchLimit
                  ? '$_searchLimit件以上'
                  : '${searchResults.length} 件',
              style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
            ),
          ],
        ),
        const SizedBox(height: 12),

        if (_isSearching)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
            child: const Center(child: CircularProgressIndicator()),
          )
        else if (_searchError != null)
          _buildErrorCard(_searchError!, () => _runSearch(_searchQuery))
        else if (searchResults.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
            child: const Center(child: Text('該当する科目がみつかりませんでした', style: TextStyle(color: Color(0xFF94A3B8)))),
          )
        else
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: searchResults.length,
            itemBuilder: (context, index) {
              final sub = searchResults[index];
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: const BorderSide(color: Color(0xFFE2E8F0)),
                ),
                child: ListTile(
                  title: Text(sub.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  subtitle: Text('${sub.faculty} • ${sub.timeSlotLabel} • 担当: ${sub.lecturer}'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.calendar_today_rounded, color: Color(0xFF0F4C81), size: 20),
                        tooltip: '時間割に直接追加',
                        onPressed: () => _showDirectRegisterDialog(sub),
                      ),
                      const Icon(Icons.chevron_right_rounded, color: Color(0xFF0F4C81)),
                    ],
                  ),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => CourseDetailScreen(store: widget.store, subject: sub),
                      ),
                    );
                  },
                ),
              );
            },
          ),
      ],
    );
  }

  Widget _buildRegisteredTimetableGrid(List<Subject> registeredSubjects) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('あなたの時間割', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            Row(
              children: [
                // Swapped axes toggle (縦横切替)
                if (_isGridView)
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _isTransposed = !_isTransposed;
                      });
                    },
                    style: TextButton.styleFrom(
                      foregroundColor: const Color(0xFF0F4C81),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    ),
                    icon: const Icon(Icons.swap_vertical_circle_outlined, size: 16),
                    label: const Text('縦横切替', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)),
                  ),
                const SizedBox(width: 6),
                // Grid view / Card list view toggle
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _isGridView = !_isGridView;
                    });
                  },
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFF64748B),
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  ),
                  icon: Icon(_isGridView ? Icons.view_list_rounded : Icons.grid_on_rounded, size: 16),
                  label: Text(_isGridView ? 'リスト表示' : 'グリッド表示', style: const TextStyle(fontSize: 11.5)),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 12),

        if (registeredSubjects.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Column(
              children: [
                const Icon(Icons.calendar_today_outlined, size: 36, color: Color(0xFFCBD5E1)),
                const SizedBox(height: 8),
                const Text('登録済みの科目がありません', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
                const SizedBox(height: 4),
                const Text('上の検索バーから検索するか、下の「時間割登録」を行ってください。', style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)), textAlign: TextAlign.center),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: _openOnboardingEditor,
                  icon: const Icon(Icons.edit_calendar_rounded, size: 18),
                  label: const Text('時間割を一括登録・編集', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0F4C81),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ],
            ),
          )
        else ...[
          if (_isGridView)
            _buildTimetableWeeklyGrid(registeredSubjects)
          else
            _buildRegisteredCardList(registeredSubjects),
          
          const SizedBox(height: 16),
          Center(
            child: OutlinedButton.icon(
              onPressed: _openOnboardingEditor,
              icon: const Icon(Icons.edit_calendar_rounded, size: 16),
              label: const Text('時間割を一括登録・編集', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF0F4C81),
                side: const BorderSide(color: Color(0xFF0F4C81)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildTimetableWeeklyGrid(List<Subject> registeredSubjects) {
    if (!_isTransposed) {
      // Days are columns, Periods are rows
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          children: [
            // Days Header
            Container(
              height: 44,
              decoration: const BoxDecoration(
                color: Color(0xFFF1F5F9),
                borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
              ),
              child: Row(
                children: [
                  const SizedBox(
                    width: 28,
                    child: Center(
                      child: Text('限', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
                    ),
                  ),
                  ...List.generate(5, (dIdx) {
                    return Expanded(
                      child: Center(
                        child: Text(
                          _dayLabels[dIdx],
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Color(0xFF334155)),
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
            // Period Rows
            ..._periods.map((period) {
              return Container(
                height: 80,
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 0.5)),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 28,
                      child: Center(
                        child: Text(
                          '$period',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: Color(0xFF64748B)),
                        ),
                      ),
                    ),
                    ...List.generate(5, (dIdx) {
                      final dayOfWeek = _days[dIdx];
                      final key = '${dayOfWeek}_$period';
                      final subjectId = widget.store.userTimetable[key];
                      final subject = subjectId != null ? _registeredById[subjectId] : null;

                      return Expanded(
                        child: _buildGridCell(subject, dayOfWeek, period),
                      );
                    }),
                  ],
                ),
              );
            }).toList(),
          ],
        ),
      );
    } else {
      // Swapped: Periods are columns, Days are rows
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          children: [
            // Periods Header
            Container(
              height: 44,
              decoration: const BoxDecoration(
                color: Color(0xFFF1F5F9),
                borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
              ),
              child: Row(
                children: [
                  const SizedBox(
                    width: 28,
                    child: Center(
                      child: Text('曜', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
                    ),
                  ),
                  ...List.generate(5, (pIdx) {
                    return Expanded(
                      child: Center(
                        child: Text(
                          '${_periods[pIdx]}',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Color(0xFF334155)),
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
            // Day Rows
            ...List.generate(5, (dIdx) {
              final dayOfWeek = _days[dIdx];
              final dayLabel = _dayLabels[dIdx];

              return Container(
                height: 80,
                decoration: const BoxDecoration(
                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 0.5)),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 28,
                      child: Center(
                        child: Text(
                          dayLabel,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: Color(0xFF64748B)),
                        ),
                      ),
                    ),
                    ..._periods.map((period) {
                      final key = '${dayOfWeek}_$period';
                      final subjectId = widget.store.userTimetable[key];
                      final subject = subjectId != null ? _registeredById[subjectId] : null;

                      return Expanded(
                        child: _buildGridCell(subject, dayOfWeek, period),
                      );
                    }).toList(),
                  ],
                ),
              );
            }),
          ],
        ),
      );
    }
  }

  Widget _buildGridCell(Subject? subject, String dayOfWeek, int period) {
    final postCount = subject != null ? widget.store.posts.where((p) => p.subjectId == subject.id && p.requestId == null).length : 0;

    return GestureDetector(
      onTap: () {
        if (subject != null) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => CourseDetailScreen(store: widget.store, subject: subject),
            ),
          ).then((_) {
            setState(() {});
          });
        } else {
          _openOnboardingEditor();
        }
      },
      child: Container(
        margin: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          color: subject != null ? const Color(0xFF0F4C81).withAlpha(15) : const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: subject != null ? const Color(0xFF0F4C81).withAlpha(40) : const Color(0xFFE2E8F0),
            width: 0.8,
          ),
        ),
        padding: const EdgeInsets.all(2),
        child: subject != null
            ? Stack(
                children: [
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 6.0),
                      child: Text(
                        subject.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 11.0,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF0F4C81),
                          height: 1.15,
                        ),
                      ),
                    ),
                  ),
                  if (postCount > 0)
                    Positioned(
                      bottom: 0,
                      right: 0,
                      left: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 0.5),
                        decoration: BoxDecoration(
                          color: const Color(0xFF10B981).withAlpha(25),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '$postCount件',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 9.0,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF059669),
                          ),
                        ),
                      ),
                    ),
                ],
              )
            : const Center(
                child: Icon(
                  Icons.add_rounded,
                  size: 14,
                  color: Color(0xFFCBD5E1),
                ),
              ),
      ),
    );
  }

  Widget _buildRegisteredCardList(List<Subject> registeredSubjects) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 2.2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
      ),
      itemCount: registeredSubjects.length,
      itemBuilder: (context, index) {
        final sub = registeredSubjects[index];
        final postCount = widget.store.posts.where((p) => p.subjectId == sub.id && p.requestId == null).length;

        return GestureDetector(
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => CourseDetailScreen(store: widget.store, subject: sub),
              ),
            ).then((_) {
              setState(() {});
            });
          },
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFE2E8F0)),
              boxShadow: [
                BoxShadow(color: Colors.black.withAlpha(3), blurRadius: 4, offset: const Offset(0, 1)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0F4C81).withAlpha(15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        sub.timeSlotLabel,
                        style: const TextStyle(fontSize: 8.5, fontWeight: FontWeight.bold, color: Color(0xFF0F4C81)),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: postCount > 0 ? const Color(0xFF10B981).withAlpha(20) : const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '$postCount 件',
                        style: TextStyle(
                          fontSize: 8.5,
                          fontWeight: FontWeight.bold,
                          color: postCount > 0 ? const Color(0xFF10B981) : const Color(0xFF94A3B8),
                        ),
                      ),
                    ),
                  ],
                ),
                Text(
                  sub.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1E293B),
                  ),
                ),
                Text(
                  '担当: ${sub.lecturer}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
