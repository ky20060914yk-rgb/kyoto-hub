import 'package:flutter/material.dart';

import '../../services/app_store.dart';
import '../../models/review.dart';

const _brand = Color(0xFF0F4C81);

/// Structured-field modal for writing / editing a course review.
///
/// Returns `true` if a review was saved or deleted, `false` if a save was
/// attempted and failed, `null` if the sheet was dismissed without submitting.
Future<bool?> showReviewFormSheet(
  BuildContext context, {
  required AppStore store,
  required String courseKey,
  required String courseName,
  Review? existing,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (context) => _ReviewFormSheetBody(
      store: store,
      courseKey: courseKey,
      courseName: courseName,
      existing: existing,
    ),
  );
}

class _ReviewFormSheetBody extends StatefulWidget {
  final AppStore store;
  final String courseKey;
  final String courseName;
  final Review? existing;

  const _ReviewFormSheetBody({
    required this.store,
    required this.courseKey,
    required this.courseName,
    required this.existing,
  });

  @override
  State<_ReviewFormSheetBody> createState() => _ReviewFormSheetBodyState();
}

class _ReviewFormSheetBodyState extends State<_ReviewFormSheetBody> {
  late final TextEditingController _commentCtrl;
  late final TextEditingController _termCtrl;
  late final TextEditingController _gradeCtrl;

  int? _rating;
  late Rakutan _rakutan;
  late Attendance _attendance;
  late GradingStyle _grading;
  late PastExamUsefulness _pastExam;
  late BringIn _bringIn;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _commentCtrl = TextEditingController(text: e?.comment);
    _termCtrl = TextEditingController(text: e?.termTaken);
    _gradeCtrl = TextEditingController(text: e?.gradeTaken);
    // M1: `Review._rating` degrades an unreadable stored rating to 0, and the
    // rules reject any write with `rating < 1`. Seeding 0 here would show an
    // "unrated" star row that satisfies `_rating != null`, so the user could
    // press 更新する and only get a bare 「保存に失敗しました」. Treat a degraded
    // rating as unset instead: the form then insists on a real 1..5 pick.
    _rating = (e?.rating ?? 0) >= 1 ? e!.rating : null;
    _rakutan = e?.rakutan ?? Rakutan.futsu;
    _attendance = e?.attendance ?? Attendance.light;
    _grading = e?.grading ?? GradingStyle.examReport;
    _pastExam = e?.pastExam ?? PastExamUsefulness.trendOnly;
    _bringIn = e?.bringIn ?? BringIn.na;
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    _termCtrl.dispose();
    _gradeCtrl.dispose();
    super.dispose();
  }

  Widget _sectionLabel(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
      );

  Widget _choiceRow<T>({
    required String label,
    required List<T> values,
    required T selected,
    required String Function(T) labelOf,
    required ValueChanged<T> onSelected,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionLabel(label),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: values.map((v) {
              return ChoiceChip(
                label: Text(labelOf(v)),
                selected: selected == v,
                selectedColor: _brand.withValues(alpha: 0.15),
                onSelected: (_) => onSelected(v),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    final rating = _rating;
    if (rating == null || rating < 1 || _submitting) return;
    setState(() => _submitting = true);
    final messenger = ScaffoldMessenger.of(context);
    final ok = await widget.store.submitReview(
      courseKey: widget.courseKey,
      courseName: widget.courseName,
      rating: rating,
      rakutan: _rakutan,
      attendance: _attendance,
      grading: _grading,
      pastExam: _pastExam,
      bringIn: _bringIn,
      comment: _commentCtrl.text,
      termTaken:
          _termCtrl.text.trim().isEmpty ? null : _termCtrl.text.trim(),
      gradeTaken:
          _gradeCtrl.text.trim().isEmpty ? null : _gradeCtrl.text.trim(),
    );
    if (!mounted) return;
    messenger.showSnackBar(SnackBar(
      content: Text(widget.store.lastNoticeMessage ??
          (ok ? '保存しました' : '保存に失敗しました')),
    ));
    Navigator.pop(context, ok);
  }

  Future<void> _confirmDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('レビューを削除',
            style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text('このレビューを削除しますか？この操作は取り消せません。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('削除する', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    await widget.store.deleteMyReview(widget.courseKey);
    if (!mounted) return;
    messenger.showSnackBar(SnackBar(
      content: Text(widget.store.lastNoticeMessage ?? 'レビューを削除しました。'),
    ));
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    // M1: `>= 1` as well as non-null — the rules require `rating` in 1..5, so
    // enabling submit for a 0 only buys the user a failed write.
    final canSubmit = _rating != null && _rating! >= 1 && !_submitting;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isEdit ? 'レビューを編集' : 'レビューを書く',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              widget.courseName,
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 6),
            const Text(
              '最初の3件のレビューは +2クレジット、レビューの少ない科目なら さらに +1クレジット',
              style: TextStyle(fontSize: 11.5, color: Color(0xFF92400E)),
            ),
            const SizedBox(height: 14),

            // おすすめ度
            _sectionLabel('おすすめ度'),
            Row(
              children: List.generate(5, (i) {
                final filled = _rating != null && i < _rating!;
                return IconButton(
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                  icon: Icon(
                    filled ? Icons.star : Icons.star_border,
                    color: _brand,
                    size: 32,
                  ),
                  onPressed: () => setState(() => _rating = i + 1),
                );
              }),
            ),
            const SizedBox(height: 14),

            _choiceRow<Rakutan>(
              label: '楽単度',
              values: Rakutan.values,
              selected: _rakutan,
              labelOf: (v) => v.label,
              onSelected: (v) => setState(() => _rakutan = v),
            ),
            _choiceRow<Attendance>(
              label: '出席',
              values: Attendance.values,
              selected: _attendance,
              labelOf: (v) => v.label,
              onSelected: (v) => setState(() => _attendance = v),
            ),
            _choiceRow<GradingStyle>(
              label: '成績のつけ方',
              values: GradingStyle.values,
              selected: _grading,
              labelOf: (v) => v.label,
              onSelected: (v) => setState(() => _grading = v),
            ),
            _choiceRow<PastExamUsefulness>(
              label: '過去問の効き',
              values: PastExamUsefulness.values,
              selected: _pastExam,
              labelOf: (v) => v.label,
              onSelected: (v) => setState(() => _pastExam = v),
            ),
            _choiceRow<BringIn>(
              label: '持ち込み',
              values: BringIn.values,
              selected: _bringIn,
              labelOf: (v) => v.label,
              onSelected: (v) => setState(() => _bringIn = v),
            ),

            _sectionLabel('コメント'),
            TextField(
              controller: _commentCtrl,
              maxLines: 4,
              maxLength: 500,
              decoration: const InputDecoration(
                hintText: '任意。授業の雰囲気、テストの傾向、注意点など',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),

            _sectionLabel('履修時期・成績（任意）'),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _termCtrl,
                    decoration: const InputDecoration(
                      hintText: '2024前期',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _gradeCtrl,
                    decoration: const InputDecoration(
                      hintText: 'A',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('キャンセル',
                      style: TextStyle(color: Colors.grey)),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: canSubmit ? _submit : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _brand,
                    foregroundColor: Colors.white,
                  ),
                  child: Text(
                    isEdit ? '更新する' : '投稿する',
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),

            if (isEdit)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _submitting ? null : _confirmDelete,
                  child: const Text('レビューを削除',
                      style: TextStyle(color: Colors.red)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
