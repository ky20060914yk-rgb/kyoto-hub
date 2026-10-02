import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../../models/subject.dart';

import '../navigation_root_screen.dart';

class TimetableRegistrationScreen extends StatefulWidget {
  final AppStore store;
  final bool isOnboarding;

  const TimetableRegistrationScreen({super.key, required this.store, this.isOnboarding = true});

  @override
  State<TimetableRegistrationScreen> createState() => _TimetableRegistrationScreenState();
}

class _TimetableRegistrationScreenState extends State<TimetableRegistrationScreen> {
  final List<String> _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  final List<String> _dayLabels = ['月', '火', '水', '木', '金'];
  final List<int> _periods = [1, 2, 3, 4, 5];

  /// Subjects currently registered in the timetable, resolved asynchronously
  /// from Firestore via CourseRepository and keyed by course id.
  Map<String, Subject> _registeredById = {};

  @override
  void initState() {
    super.initState();
    _refreshRegistered();
  }

  Future<void> _refreshRegistered() async {
    final list = await widget.store.getRegisteredSubjects();
    if (!mounted) return;
    setState(() {
      _registeredById = {for (final s in list) s.id: s};
    });
  }

  void _proceedToHome() {
    if (widget.isOnboarding) {
      widget.store.completeOnboarding();
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => NavigationRootScreen(store: widget.store),
        ),
      );
    } else {
      Navigator.of(context).pop();
    }
  }

  /// Adding a course to the shared catalog is a `courses` create, and the
  /// security rules only allow that for a *verified* KU account (C4). The
  /// onboarding flow runs before the confirmation link has been clicked, so the
  /// button has to say so up front rather than failing silently afterwards.
  bool get _canAddCustomSubject => widget.store.currentUser?.isVerified == true;

  static const _unverifiedAddMessage =
      'メール認証の完了後に科目を追加できます。（通信環境もご確認ください）';

  void _showAddCustomSubjectModal(String dayOfWeek, int period) {
    final nameController = TextEditingController();
    final lecturerController = TextEditingController();
    String selectedFaculty = '工学部';
    final faculties = ['工学部', '法学部', '理学部', '文学部', '経済学部', '農学部', '医学部/薬学部', '総合人間学部', '全学共通'];

    final dayMap = {'Mon': '月曜', 'Tue': '火曜', 'Wed': '水曜', 'Thu': '木曜', 'Fri': '金曜'};

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 20, right: 20, top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('新規科目をマスタに追加 (${dayMap[dayOfWeek]} $period限)', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('追加した科目はCloud Firestoreへリアルタイム保存されます', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                  if (!_canAddCustomSubject) ...[
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.warning_amber_rounded, color: Color(0xFFD97706), size: 20),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _unverifiedAddMessage,
                              style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),

                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: '科目名 (必須)', hintText: '例: 機械力学II, 憲法I', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),

                  Row(
                    children: [
                      const Text('開講学部: ', style: TextStyle(fontWeight: FontWeight.bold)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: selectedFaculty,
                          decoration: const InputDecoration(border: OutlineInputBorder()),
                          items: faculties.map((f) => DropdownMenuItem(value: f, child: Text(f))).toList(),
                          onChanged: (val) {
                            if (val != null) setModalState(() => selectedFaculty = val);
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  TextField(
                    controller: lecturerController,
                    decoration: const InputDecoration(labelText: '担当教員名', hintText: '例: 京大 太郎 教授', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 20),

                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: ElevatedButton(
                      onPressed: !_canAddCustomSubject
                          ? null
                          : () async {
                        if (nameController.text.trim().isEmpty) return;
                        final messenger = ScaffoldMessenger.of(context);
                        final navigator = Navigator.of(context);
                        // The write can be refused (unverified account) or simply
                        // fail (offline). Either way the modal must report it and
                        // stay put rather than popping as if it had succeeded (C4).
                        try {
                          await widget.store.addCustomSubject(
                            name: nameController.text.trim(),
                            faculty: selectedFaculty,
                            dayOfWeek: dayOfWeek,
                            period: period,
                            lecturer: lecturerController.text.trim().isEmpty ? '担当教員' : lecturerController.text.trim(),
                            category: selectedFaculty == '全学共通' ? '全学共通科目' : '専門科目',
                          );
                        } catch (_) {
                          messenger.showSnackBar(
                            const SnackBar(content: Text(_unverifiedAddMessage)),
                          );
                          return;
                        }
                        navigator.pop();
                        if (!mounted) return;
                        await _refreshRegistered();
                        messenger.showSnackBar(
                          SnackBar(content: Text(widget.store.lastNoticeMessage ?? '科目を追加しました')),
                        );
                      },
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0F4C81), foregroundColor: Colors.white),
                      child: Text(
                        _canAddCustomSubject ? '科目を追加して保存' : 'メール認証が必要です',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _openCourseSelectionModal(String dayOfWeek, int period) {
    String searchQuery = '';
    final key = '${dayOfWeek}_$period';
    final currentSubjectId = widget.store.userTimetable[key];
    // Kicked off once, outside the builders, so rebuilds do not refetch.
    final slotFuture = widget.store.courses.forSlot(dayOfWeek, period);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        final dayMap = {'Mon': '月曜', 'Tue': '火曜', 'Wed': '水曜', 'Thu': '木曜', 'Fri': '金曜'};

        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              height: MediaQuery.of(context).size.height * 0.8,
              padding: EdgeInsets.only(
                left: 20, right: 20, top: 16,
                bottom: MediaQuery.of(context).viewInsets.bottom + 16,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.grey[300],
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${dayMap[dayOfWeek]} $period限 の科目を選択',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1E293B),
                        ),
                      ),
                      TextButton.icon(
                        onPressed: () {
                          Navigator.pop(context);
                          _showAddCustomSubjectModal(dayOfWeek, period);
                        },
                        icon: const Icon(Icons.add_rounded, size: 18),
                        label: const Text('新規科目追加', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

                  TextField(
                    onChanged: (val) {
                      setModalState(() {
                        searchQuery = val;
                      });
                    },
                    decoration: InputDecoration(
                      hintText: '科目の名前や担当教員名で検索...',
                      prefixIcon: const Icon(Icons.search, color: Color(0xFF64748B)),
                      contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
                      filled: true,
                      fillColor: const Color(0xFFF1F5F9),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  Expanded(
                    child: FutureBuilder<List<Subject>>(
                      future: slotFuture,
                      builder: (context, snapshot) {
                        if (snapshot.connectionState != ConnectionState.done) {
                          return const Center(child: CircularProgressIndicator());
                        }

                        final allSlotSubjects = snapshot.data ?? const <Subject>[];
                        final filteredSubjects = allSlotSubjects.where((sub) {
                          if (searchQuery.isEmpty) return true;
                          final query = searchQuery.toLowerCase();
                          return sub.name.toLowerCase().contains(query) ||
                              sub.lecturer.toLowerCase().contains(query) ||
                              sub.faculty.toLowerCase().contains(query);
                        }).toList();

                        if (filteredSubjects.isEmpty) {
                          return Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Text('該当する科目がありません', style: TextStyle(color: Colors.grey)),
                                const SizedBox(height: 12),
                                ElevatedButton.icon(
                                  onPressed: () {
                                    Navigator.pop(context);
                                    _showAddCustomSubjectModal(dayOfWeek, period);
                                  },
                                  icon: const Icon(Icons.add),
                                  label: const Text('このコマに新しい科目を追加'),
                                ),
                              ],
                            ),
                          );
                        }

                        return ListView.separated(
                          itemCount: filteredSubjects.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (context, index) {
                            final sub = filteredSubjects[index];
                            final isSelected = sub.id == currentSubjectId;

                            return ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              title: Text(
                                sub.name,
                                style: TextStyle(
                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                                  color: isSelected ? const Color(0xFF0F4C81) : Colors.black87,
                                ),
                              ),
                              subtitle: Text('${sub.faculty} • 区分: ${sub.category} • 担当: ${sub.lecturer}'),
                              trailing: isSelected
                                  ? const Icon(Icons.check_circle_rounded, color: Color(0xFF0F4C81))
                                  : OutlinedButton(
                                      onPressed: () {
                                        widget.store.registerTimetableSubject(dayOfWeek, period, sub.id);
                                        _refreshRegistered();
                                        Navigator.pop(context);
                                      },
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(color: Color(0xFF0F4C81)),
                                      ),
                                      child: const Text('登録', style: TextStyle(color: Color(0xFF0F4C81))),
                                    ),
                              onTap: () {
                                if (isSelected) {
                                  widget.store.removeTimetableSubject(dayOfWeek, period);
                                } else {
                                  widget.store.registerTimetableSubject(dayOfWeek, period, sub.id);
                                }
                                _refreshRegistered();
                                Navigator.pop(context);
                              },
                            );
                          },
                        );
                      },
                    ),
                  ),
                  if (currentSubjectId != null) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: TextButton.icon(
                        onPressed: () {
                          widget.store.removeTimetableSubject(dayOfWeek, period);
                          _refreshRegistered();
                          Navigator.pop(context);
                        },
                        icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                        label: const Text('このマスの登録を解除', style: TextStyle(color: Colors.redAccent)),
                      ),
                    ),
                  ]
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final registeredCount = widget.store.userTimetable.length;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: const Text(
          '時間割の登録',
          style: TextStyle(color: Color(0xFF1E293B), fontWeight: FontWeight.bold),
        ),
        actions: widget.isOnboarding
            ? [
                TextButton(
                  onPressed: _proceedToHome,
                  child: const Text(
                    'スキップ',
                    style: TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                  ),
                ),
              ]
            : null,
      ),
      body: SafeArea(
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              color: const Color(0xFFEFF6FF),
              child: Row(
                children: const [
                  Icon(Icons.info_outline_rounded, color: Color(0xFF2563EB), size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '「情報が欲しい、または提供できる科目を登録してください」',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1D4ED8),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Text(
                '各マスをタップすると、科目の名前や教員名で検索し、時間割に登録できます。登録した科目の過去問やレビューをチェックしてみましょう。',
                style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
              ),
            ),

            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Column(
                    children: [
                      Container(
                        height: 38,
                        decoration: const BoxDecoration(
                          color: Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
                        ),
                        child: Row(
                          children: [
                            const SizedBox(
                              width: 32,
                              child: Center(
                                child: Text('限', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF64748B))),
                              ),
                            ),
                            ...List.generate(5, (dIdx) {
                              return Expanded(
                                child: Center(
                                  child: Text(
                                    _dayLabels[dIdx],
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13,
                                      color: Color(0xFF334155),
                                    ),
                                  ),
                                ),
                              );
                            }),
                          ],
                        ),
                      ),

                      Expanded(
                        child: Column(
                          children: _periods.map((period) {
                            return Expanded(
                              child: Container(
                                decoration: const BoxDecoration(
                                  border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 0.5)),
                                ),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 32,
                                      child: Center(
                                        child: Text(
                                          '$period',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 12,
                                            color: Color(0xFF64748B),
                                          ),
                                        ),
                                      ),
                                    ),

                                    ...List.generate(5, (dIdx) {
                                      final dayOfWeek = _days[dIdx];
                                      final key = '${dayOfWeek}_$period';
                                      final registeredId = widget.store.userTimetable[key];
                                      final subject = registeredId != null ? _registeredById[registeredId] : null;

                                      return Expanded(
                                        child: GestureDetector(
                                          onTap: () => _openCourseSelectionModal(dayOfWeek, period),
                                          child: Container(
                                            margin: const EdgeInsets.all(2),
                                            decoration: BoxDecoration(
                                              color: subject != null
                                                  ? const Color(0xFF0F4C81).withAlpha(20)
                                                  : const Color(0xFFFAFAFA),
                                              borderRadius: BorderRadius.circular(6),
                                              border: Border.all(
                                                color: subject != null
                                                    ? const Color(0xFF0F4C81).withAlpha(60)
                                                    : const Color(0xFFF1F5F9),
                                              ),
                                            ),
                                            padding: const EdgeInsets.all(4),
                                            child: subject != null
                                                ? Center(
                                                    child: Text(
                                                      subject.name,
                                                      maxLines: 2,
                                                      overflow: TextOverflow.ellipsis,
                                                      textAlign: TextAlign.center,
                                                      style: const TextStyle(
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                        color: Color(0xFF0F4C81),
                                                      ),
                                                    ),
                                                  )
                                                : const Center(
                                                    child: Icon(
                                                      Icons.add_rounded,
                                                      size: 16,
                                                      color: Color(0xFFCBD5E1),
                                                    ),
                                                  ),
                                          ),
                                        ),
                                      );
                                    }),
                                  ],
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            Padding(
              padding: const EdgeInsets.all(16.0),
              child: SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _proceedToHome,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0F4C81),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    widget.isOnboarding
                        ? (registeredCount > 0 ? 'この時間割で確定 ($registeredCount 科目登録)' : '登録を完了してホームへ')
                        : (registeredCount > 0 ? '変更を保存して閉じる ($registeredCount 科目登録)' : '編集を完了して閉じる'),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
