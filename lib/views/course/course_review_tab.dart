import 'package:flutter/material.dart';

import '../../models/course_stats.dart';
import '../../models/review.dart';
import '../../models/subject.dart';
import '../../services/app_store.dart';
import 'review_form_sheet.dart';

const _brand = Color(0xFF0F4C81);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE2E8F0);

/// レビュー tab on the course detail screen.
///
/// Ruling P5: this is a [StatefulWidget] and the three streams are created
/// exactly once in [initState]. The `build` method's [StreamBuilder]s consume
/// those fields — it must never call `store.reviews.stream*()` itself (that
/// re-subscribes on every rebuild — the Phase-1a anti-pattern).
class CourseReviewTab extends StatefulWidget {
  const CourseReviewTab({super.key, required this.store, required this.subject});

  final AppStore store;
  final Subject subject;

  @override
  State<CourseReviewTab> createState() => _CourseReviewTabState();
}

class _CourseReviewTabState extends State<CourseReviewTab> {
  late final Stream<List<Review>> _reviews$;
  late final Stream<CourseStats> _stats$;
  late final Stream<Review?> _mine$;

  @override
  void initState() {
    super.initState();
    final courseKey = widget.subject.courseKey;
    _reviews$ = widget.store.reviews.streamReviewsForCourse(courseKey);
    _stats$ = widget.store.reviews.streamStats(courseKey);
    final user = widget.store.currentUser;
    // Consumed by two StreamBuilders (the write button + the list), so it must
    // tolerate multiple listeners regardless of the source stream's kind.
    _mine$ = (user != null
            ? widget.store.reviews.streamMyReview(courseKey, user.uid)
            : Stream<Review?>.value(null))
        .asBroadcastStream();
  }

  static const _emptyMessage = 'まだレビューがありません。最初のレビューを書きましょう！';

  void _openForm({Review? existing}) {
    showReviewFormSheet(
      context,
      store: widget.store,
      courseKey: widget.subject.courseKey,
      courseName: widget.subject.name,
      existing: existing,
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _SummaryCard(stats$: _stats$),
        const SizedBox(height: 16),
        _WriteButton(mine$: _mine$, store: widget.store, onWrite: _openForm),
        const SizedBox(height: 20),
        StreamBuilder<Review?>(
          stream: _mine$,
          builder: (context, mineSnap) {
            return StreamBuilder<List<Review>>(
              stream: _reviews$,
              builder: (context, snap) {
                // I1: an error must never degrade into 「まだレビューがありません」 —
                // that invites the reader to write "the first" review on a
                // course that may already have many. Only the LIST stream is
                // fatal here; if `_mine$` alone fails the list is still true, it
                // just loses the "yours pinned to the top" ordering, and the
                // write button below reports that failure itself.
                if (snap.hasError) return const _InlineError();
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                final all = snap.data ?? const <Review>[];
                if (all.isEmpty) {
                  return const _EmptyBox(message: _emptyMessage);
                }
                final uid = widget.store.currentUser?.uid;
                final mineId = mineSnap.data?.id;
                final mine = <Review>[];
                final others = <Review>[];
                for (final r in all) {
                  if (mineId != null && r.id == mineId) {
                    mine.add(r);
                  } else {
                    others.add(r);
                  }
                }
                final ordered = [...mine, ...others];
                return Column(
                  children: [
                    for (final r in ordered)
                      _ReviewCard(
                        review: r,
                        isMine: r.id == mineId,
                        currentUid: uid,
                        canHelpful:
                            widget.store.currentUser?.isVerified == true,
                        onEdit: () => _openForm(existing: r),
                        onHelpful: () =>
                            widget.store.markReviewHelpful(r.id),
                      ),
                  ],
                );
              },
            );
          },
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.stats$});

  final Stream<CourseStats> stats$;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<CourseStats>(
      stream: stats$,
      builder: (context, snap) {
        // I1: BEFORE the null-as-loading branch. On a stream error `data` stays
        // null forever, so without this the card spins for the rest of the
        // session.
        if (snap.hasError) return const _InlineError();
        final stats = snap.data;
        return _CardShell(
          child: stats == null
              ? const SizedBox(
                  height: 96,
                  child: Center(child: CircularProgressIndicator()),
                )
              : _summaryBody(context, stats),
        );
      },
    );
  }

  Widget _summaryBody(BuildContext context, CourseStats stats) {
    if (stats.reviewCount == 0) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _header(stats),
          const SizedBox(height: 12),
          const Text(
            'まだレビューがありません。最初のレビューを書きましょう！',
            style: TextStyle(fontSize: 13, color: _muted),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _header(stats),
        const SizedBox(height: 14),
        _distRow('楽単度', stats.rakutanCounts,
            Rakutan.values.map((e) => (e.label, e.value)).toList()),
        _distRow('出席', stats.attendanceCounts,
            Attendance.values.map((e) => (e.label, e.value)).toList()),
        _distRow('成績のつけ方', stats.gradingCounts,
            GradingStyle.values.map((e) => (e.label, e.value)).toList()),
        _distRow('過去問の効き', stats.pastExamCounts,
            PastExamUsefulness.values.map((e) => (e.label, e.value)).toList()),
        _distRow('持ち込み', stats.bringInCounts,
            BringIn.values.map((e) => (e.label, e.value)).toList()),
      ],
    );
  }

  Widget _header(CourseStats stats) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(
          stats.avgRating.toStringAsFixed(1),
          style: const TextStyle(
            fontSize: 34,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1E293B),
            height: 1.0,
          ),
        ),
        const SizedBox(width: 10),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            _StarRow(rating: stats.avgRating, size: 18),
            const SizedBox(height: 2),
            Text(
              '(${stats.reviewCount}件)',
              style: const TextStyle(fontSize: 12, color: _muted),
            ),
          ],
        ),
        const Spacer(),
        _rakutanChip(stats.rakutanScore.round()),
      ],
    );
  }

  Widget _rakutanChip(int score) {
    final Color color;
    if (score >= 66) {
      color = const Color(0xFF16A34A);
    } else if (score >= 33) {
      color = const Color(0xFFD97706);
    } else {
      color = const Color(0xFFDC2626);
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('楽単スコア',
              style: TextStyle(fontSize: 10, color: _muted)),
          Text(
            '$score/100',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _distRow(
      String title, Map<String, int> counts, List<(String, String)> order) {
    var total = 0;
    for (final v in counts.values) {
      total += v;
    }
    final denom = total < 1 ? 1 : total;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.bold, color: _muted)),
          const SizedBox(height: 4),
          for (final (label, key) in order)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: [
                  SizedBox(
                    width: 76,
                    child: Text(label,
                        style: const TextStyle(fontSize: 11),
                        overflow: TextOverflow.ellipsis),
                  ),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, c) {
                        final n = counts[key] ?? 0;
                        final frac = n / denom;
                        return Stack(
                          children: [
                            Container(
                              height: 8,
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                borderRadius: BorderRadius.circular(4),
                              ),
                            ),
                            Container(
                              height: 8,
                              width: c.maxWidth * frac,
                              decoration: BoxDecoration(
                                color: _brand.withValues(alpha: 0.75),
                                borderRadius: BorderRadius.circular(4),
                              ),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 20,
                    child: Text(
                      '${counts[key] ?? 0}',
                      textAlign: TextAlign.right,
                      style: const TextStyle(fontSize: 11, color: _muted),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Write / edit button
// ---------------------------------------------------------------------------

class _WriteButton extends StatelessWidget {
  const _WriteButton(
      {required this.mine$, required this.store, required this.onWrite});

  final Stream<Review?> mine$;
  final AppStore store;
  final void Function({Review? existing}) onWrite;

  @override
  Widget build(BuildContext context) {
    final user = store.currentUser;
    if (user == null) {
      return const Text(
        'レビューを書くにはログインしてください。',
        style: TextStyle(fontSize: 12, color: _muted),
      );
    }
    if (!user.isVerified) {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: null,
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 12),
          ),
          child: const Text('メール認証後にレビューを書けます'),
        ),
      );
    }

    return StreamBuilder<Review?>(
      stream: mine$,
      builder: (context, snap) {
        // I1: `null` legitimately means "no review yet" on this stream, so an
        // error would otherwise render 「レビューを書く」 to someone who already has
        // one — and the write would then land as an unintended overwrite.
        if (snap.hasError) return const _InlineError(compact: true);
        final mine = snap.data;
        if (mine == null) {
          return SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () => onWrite(),
              icon: const Icon(Icons.rate_review_outlined, size: 18),
              label: const Text('レビューを書く'),
              style: ElevatedButton.styleFrom(
                backgroundColor: _brand,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          );
        }
        return SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => onWrite(existing: mine),
            icon: const Icon(Icons.edit_outlined, size: 18),
            label: const Text('自分のレビューを編集'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _brand,
              side: const BorderSide(color: _brand),
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Review card
// ---------------------------------------------------------------------------

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({
    required this.review,
    required this.isMine,
    required this.currentUid,
    required this.canHelpful,
    required this.onEdit,
    required this.onHelpful,
  });

  final Review review;
  final bool isMine;
  final String? currentUid;
  final bool canHelpful;
  final VoidCallback onEdit;
  final VoidCallback onHelpful;

  @override
  Widget build(BuildContext context) {
    final chips = <String>[
      review.rakutan.label,
      review.attendance.label,
      review.grading.label,
      review.pastExam.label,
      review.bringIn.label,
    ];
    final alreadyHelpful =
        currentUid != null && review.helpfulBy.contains(currentUid);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isMine ? _brand : _border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _StarRow(rating: review.rating.toDouble(), size: 16),
                const SizedBox(width: 6),
                Text('${review.rating}',
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.bold)),
                const Spacer(),
                if (isMine)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: _brand.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Text('あなたのレビュー',
                        style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: _brand)),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final c in chips)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(c,
                        style:
                            const TextStyle(fontSize: 11, color: Color(0xFF475569))),
                  ),
              ],
            ),
            if (review.comment.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(review.comment,
                  style: const TextStyle(fontSize: 13, color: Color(0xFF334155))),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _footerText(review),
                    style: const TextStyle(fontSize: 11, color: _muted),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isMine)
                  TextButton.icon(
                    onPressed: onEdit,
                    icon: const Icon(Icons.edit_outlined, size: 14),
                    label: const Text('編集', style: TextStyle(fontSize: 12)),
                    style: TextButton.styleFrom(
                      foregroundColor: _brand,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                // I3: the author may not vote for their own review — `helpfulBy`
                // feeds the マイページ 貢献 badge, so a self-vote is self-inflation.
                // The durable half of this is the `reviews` update rule, which
                // excludes the author from the append-only branch; here the
                // count is still shown, just as an inert label rather than a
                // button that would fail with PERMISSION_DENIED.
                if (isMine)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.thumb_up_outlined,
                            size: 14, color: _muted),
                        const SizedBox(width: 4),
                        Text('${review.helpfulCount}',
                            style: const TextStyle(fontSize: 12, color: _muted)),
                      ],
                    ),
                  )
                else
                  TextButton.icon(
                    onPressed:
                        (alreadyHelpful || !canHelpful) ? null : onHelpful,
                    icon: Icon(
                      alreadyHelpful
                          ? Icons.thumb_up
                          : Icons.thumb_up_outlined,
                      size: 14,
                    ),
                    label: Text('${review.helpfulCount}',
                        style: const TextStyle(fontSize: 12)),
                    style: TextButton.styleFrom(
                      foregroundColor: alreadyHelpful ? _brand : _muted,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _footerText(Review r) {
    final parts = <String>[
      r.authorName.isEmpty ? '匿名京大生' : r.authorName,
      if (r.termTaken != null && r.termTaken!.trim().isNotEmpty) r.termTaken!,
      _relativeDate(r.updatedAt),
    ];
    return parts.join('・');
  }

  static String _relativeDate(DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inDays >= 365) return '${(diff.inDays / 365).floor()}年前';
    if (diff.inDays >= 30) return '${(diff.inDays / 30).floor()}ヶ月前';
    if (diff.inDays >= 1) return '${diff.inDays}日前';
    if (diff.inHours >= 1) return '${diff.inHours}時間前';
    if (diff.inMinutes >= 1) return '${diff.inMinutes}分前';
    return 'たった今';
  }
}

// ---------------------------------------------------------------------------
// Small shared widgets
// ---------------------------------------------------------------------------

class _CardShell extends StatelessWidget {
  const _CardShell({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _border),
      ),
      child: child,
    );
  }
}

/// I1: what a review [StreamBuilder] renders when its stream FAILS.
///
/// Every stream on this tab used to fold an error into a benign state — the
/// summary card treated `data == null` as "still loading" and span a spinner
/// forever, and the list rendered 「まだレビューがありません」, telling the reader to
/// write the first review on a course that may already have dozens. A stream
/// error here is ordinary (offline, a rules change, a missing index), so it has
/// to be *named*, not disguised as an empty or pending state.
///
/// There is no retry button: the streams are created once in [initState]
/// (ruling P5), so the honest recovery is reopening the screen — which is what
/// the hint says.
class _InlineError extends StatelessWidget {
  const _InlineError({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final row = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.cloud_off_rounded, size: 18, color: Color(0xFFCBD5E1)),
        const SizedBox(width: 8),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '読み込みに失敗しました',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF64748B)),
              ),
              if (!compact) ...[
                const SizedBox(height: 2),
                const Text(
                  '通信環境を確認して、画面を開き直してください。',
                  style: TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                ),
              ],
            ],
          ),
        ),
      ],
    );
    if (compact) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: row,
      );
    }
    return _CardShell(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Center(child: row),
      ),
    );
  }
}

class _EmptyBox extends StatelessWidget {
  const _EmptyBox({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return _CardShell(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
        ),
      ),
    );
  }
}

class _StarRow extends StatelessWidget {
  const _StarRow({required this.rating, this.size = 16});
  final double rating;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        final fill = (rating - i).clamp(0.0, 1.0);
        IconData icon;
        if (fill >= 0.75) {
          icon = Icons.star;
        } else if (fill >= 0.25) {
          icon = Icons.star_half;
        } else {
          icon = Icons.star_border;
        }
        return Icon(icon, size: size, color: const Color(0xFFF59E0B));
      }),
    );
  }
}
