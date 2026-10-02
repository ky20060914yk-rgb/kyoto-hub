import '../../widgets/credit_rules_dialog.dart';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/app_store.dart';
import '../../models/post.dart';
import '../../models/review.dart';
import '../auth/signup_screen.dart';
import '../contact/contact_screen.dart';
import '../course/review_form_sheet.dart';
import '../textbook/textbook_lending_screen.dart';
import '../timetable/timetable_registration_screen.dart';

class MyPageScreen extends StatefulWidget {
  final AppStore store;

  const MyPageScreen({super.key, required this.store});

  @override
  State<MyPageScreen> createState() => _MyPageScreenState();
}

class _MyPageScreenState extends State<MyPageScreen> {
  // Held once (Phase-1a ruling: no stream creation inside build()). If there is
  // no signed-in user, an empty stream so the card still renders its zero state.
  late final Stream<List<Review>> _myReviewsStream;

  @override
  void initState() {
    super.initState();
    final user = widget.store.currentUser;
    _myReviewsStream = user == null
        ? Stream.value(const <Review>[])
        : widget.store.reviews.streamMyReviews(user.uid);
  }

  Widget _buildContributionCard() {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: StreamBuilder<List<Review>>(
          stream: _myReviewsStream,
          builder: (context, snapshot) {
            // I1: `data ?? []` folds a stream error into an honest-looking zero
            // — 「レビュー 0件」 and no badge — which reads as "your contributions
            // were wiped", not "we could not load them". Name the failure.
            if (snapshot.hasError) return const _ContributionError();
            final list = snapshot.data ?? const <Review>[];
            final reviews = list.length;
            final helpful = list.fold<int>(0, (a, r) => a + r.helpfulCount);
            String? badge;
            if (reviews >= 20 || helpful >= 50) {
              badge = 'トップ貢献者';
            } else if (reviews >= 5 || helpful >= 10) {
              badge = '貢献者';
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text(
                      'あなたの貢献',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                    ),
                    const Spacer(),
                    if (badge != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0F4C81).withAlpha(20),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.workspace_premium_rounded, size: 14, color: Color(0xFF0F4C81)),
                            const SizedBox(width: 4),
                            Text(badge, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF0F4C81))),
                          ],
                        ),
                      )
                    else
                      const Text('まだ貢献バッジがありません', style: TextStyle(fontSize: 10, color: Color(0xFF94A3B8))),
                  ],
                ),
                const SizedBox(height: 12),
                Text('レビュー $reviews件', style: const TextStyle(fontSize: 13, color: Color(0xFF334155))),
                const SizedBox(height: 4),
                Text('受け取った「役に立った」 $helpful', style: const TextStyle(fontSize: 13, color: Color(0xFF334155))),
                const SizedBox(height: 4),
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 4),
                    title: Text(
                      '自分のレビュー ($reviews)',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                    ),
                    children: list.isEmpty
                        ? const [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: Padding(
                                padding: EdgeInsets.symmetric(vertical: 4),
                                child: Text('まだレビューを書いていません', style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
                              ),
                            ),
                          ]
                        : list.map(_buildMyReviewRow).toList(),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildMyReviewRow(Review review) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  review.courseName.isEmpty ? '(科目名なし)' : review.courseName,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1E293B)),
                ),
                Row(
                  children: List.generate(
                    5,
                    (i) => Icon(
                      i < review.rating ? Icons.star : Icons.star_border,
                      size: 14,
                      color: const Color(0xFFFBBF24),
                    ),
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => showReviewFormSheet(
              context,
              store: widget.store,
              courseKey: review.courseKey,
              courseName: review.courseName,
              existing: review,
            ),
            child: const Text('編集', style: TextStyle(fontSize: 12, color: Color(0xFF0F4C81))),
          ),
        ],
      ),
    );
  }

  void _showDeleteConfirmDialog(String postId, String title) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('投稿の削除'),
          content: Text('「$title」の投稿を削除しますか？\n(削除すると他の人がダウンロードできなくなります)'),
          actions: [
            TextButton(
              child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
              onPressed: () => Navigator.pop(context),
            ),
            TextButton(
              child: const Text('削除する', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
              onPressed: () {
                widget.store.deletePost(postId);
                Navigator.pop(context);
                setState(() {});
              },
            ),
          ],
        );
      },
    );
  }

  void _showEditUsernameDialog(BuildContext context, String currentName) {
    final controller = TextEditingController(text: currentName);
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('ユーザー名の変更'),
          content: TextField(
            controller: controller,
            maxLength: 15,
            decoration: const InputDecoration(
              hintText: '新しいユーザー名を入力',
              border: OutlineInputBorder(),
            ),
          ),
          actions: [
            TextButton(
              child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
              onPressed: () => Navigator.pop(context),
            ),
            TextButton(
              child: const Text('更新する', style: TextStyle(color: Color(0xFF0F4C81), fontWeight: FontWeight.bold)),
              onPressed: () async {
                final newName = controller.text.trim();
                if (newName.isNotEmpty) {
                  final success = await widget.store.updateDisplayName(newName);
                  if (success && mounted) {
                    Navigator.pop(context);
                    setState(() {});
                  }
                }
              },
            ),
          ],
        );
      },
    );
  }

  void _showLogoutConfirmDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('ログアウト'),
          content: const Text('本当にログアウトしますか？'),
          actions: [
            TextButton(
              child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
              onPressed: () => Navigator.pop(context),
            ),
            TextButton(
              child: const Text('ログアウトする', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
              onPressed: () {
                widget.store.logout();
                Navigator.pop(context);
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute(builder: (_) => SignupScreen(store: widget.store)),
                );
              },
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.store.currentUser;
    final myPosts = user != null
        ? widget.store.posts.where((p) => p.authorId == user.uid).toList()
        : <Post>[];
    final txs = widget.store.ledger;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: const Text(
          'マイページ',
          style: TextStyle(color: Color(0xFF1E293B), fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: Colors.grey),
            onPressed: _showLogoutConfirmDialog,
            tooltip: 'ログアウト',
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // User Card & Point Balance Display
            Card(
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 28,
                          backgroundColor: const Color(0xFF0F4C81),
                          child: Text(
                            user?.displayName.isNotEmpty == true ? user!.displayName.substring(0, 1) : '京',
                            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    user?.displayName ?? '未ログイン',
                                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.edit_outlined, size: 16, color: Color(0xFF64748B)),
                                    onPressed: () {
                                      _showEditUsernameDialog(context, user?.displayName ?? '');
                                    },
                                    constraints: const BoxConstraints(),
                                    padding: const EdgeInsets.all(4),
                                  ),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(color: const Color(0xFF0F4C81).withAlpha(20), borderRadius: BorderRadius.circular(4)),
                                    child: Text(
                                      user?.isVerified == true ? '京大認証済' : 'メール未認証',
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: user?.isVerified == true ? const Color(0xFF0F4C81) : const Color(0xFFD97706),
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(user?.email ?? '', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 28),

                    // Points Container
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF0F4C81), Color(0xFF1E5B94)],
                        ),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('保有クレジット', style: TextStyle(color: Colors.white70, fontSize: 12)),
                              const SizedBox(height: 4),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.baseline,
                                textBaseline: TextBaseline.alphabetic,
                                children: [
                                  Text(
                                    '${widget.store.creditBalance}',
                                    style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(width: 4),
                                  const Text('クレジット', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                                ],
                              ),
                            ],
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(color: Colors.white.withAlpha(40), borderRadius: BorderRadius.circular(20)),
                                child: const Text('1クレジット = 資料1つ', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                              ),
                              const SizedBox(height: 6),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Invitation Code Info
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.card_giftcard, size: 18, color: Color(0xFF0F4C81)),
                          const SizedBox(width: 8),
                          Text('あなたの招待コード: ${widget.store.invitationCode ?? '発行中…'}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          if (widget.store.invitationCode != null)
                            IconButton(
                              icon: const Icon(Icons.copy_rounded, size: 16),
                              tooltip: 'コピー',
                              visualDensity: VisualDensity.compact,
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: widget.store.invitationCode!));
                                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('招待コードをコピーしました')));
                              },
                            ),
                          const Spacer(),
                          const Text('友だち登録で あなたも友だちも +3クレジット', style: TextStyle(fontSize: 11, color: Color(0xFF0F4C81), fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            _buildContributionCard(),
            const SizedBox(height: 16),

            // Timetable Edit Button & Rules Button
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => TimetableRegistrationScreen(store: widget.store, isOnboarding: false),
                        ),
                      ).then((_) => setState(() {}));
                    },
                    icon: const Icon(Icons.edit_calendar_rounded, size: 18),
                    label: const Text('時間割の一括編集', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF0F4C81),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => showCreditRulesDialog(context),
                    icon: const Icon(Icons.help_outline_rounded, size: 18),
                    label: const Text('クレジット制度', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF0F4C81),
                      side: const BorderSide(color: Color(0xFF0F4C81)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // My Posts Section
            const Text('自分の投稿一覧', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(height: 10),
            if (myPosts.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE2E8F0))),
                child: const Center(child: Text('まだ投稿はありません。', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13))),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: myPosts.length,
                itemBuilder: (context, index) {
                  final p = myPosts[index];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: Color(0xFFE2E8F0))),
                    child: ListTile(
                      title: Text(p.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      subtitle: Text('${p.subjectName} • ${p.category.label} • DL: ${p.downloadCount}件'),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent, size: 20),
                            onPressed: () {
                              _showDeleteConfirmDialog(p.id, p.title);
                            },
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            const SizedBox(height: 24),

            // Transaction Audit History
            const Text('クレジット履歴', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(height: 10),
            if (txs.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE2E8F0))),
                child: const Center(child: Text('クレジット履歴はありません。', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13))),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: txs.length,
                itemBuilder: (context, index) {
                  final tx = txs[index];
                  final isPlus = tx.delta >= 0;

                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: Color(0xFFE2E8F0))),
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                      leading: CircleAvatar(
                        backgroundColor: isPlus ? const Color(0xFF10B981).withAlpha(20) : const Color(0xFFEF4444).withAlpha(20),
                        child: Icon(isPlus ? Icons.add : Icons.remove, color: isPlus ? const Color(0xFF10B981) : const Color(0xFFEF4444)),
                      ),
                      title: Text(tx.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                      subtitle: Text('${tx.createdAt.month}/${tx.createdAt.day} ${tx.createdAt.hour}:${tx.createdAt.minute.toString().padLeft(2, '0')}'),
                      trailing: Text(
                        '${isPlus ? "+" : ""}${tx.delta} クレジット',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                          color: isPlus ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                        ),
                      ),
                    ),
                  );
                },
              ),
            const SizedBox(height: 24),

            // Secondary features kept reachable without a dedicated bottom-nav tab
            // (Phase 1: nav is さがす / 時間割 / マイページ).
            const Text('その他', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(
                // Match the sibling list cards on this screen (circular(8)).
                borderRadius: BorderRadius.circular(8),
                side: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.help_outline_rounded, color: Color(0xFF0F4C81)),
                    title: const Text('お問い合わせ・不具合報告', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF1E293B))),
                    trailing: const Icon(Icons.chevron_right, color: Color(0xFF94A3B8)),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => ContactScreen(store: widget.store)),
                    ),
                  ),
                  const Divider(height: 1, color: Color(0xFFE2E8F0)),
                  ListTile(
                    leading: const Icon(Icons.menu_book_outlined, color: Color(0xFF0F4C81)),
                    title: const Text('参考書の貸し借り', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF1E293B))),
                    trailing: const Icon(Icons.chevron_right, color: Color(0xFF94A3B8)),
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => TextbookLendingScreen(store: widget.store)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// I1: what the 貢献 card renders when `streamMyReviews` fails.
///
/// Distinct from the zero state on purpose — 「レビュー 0件」 with no badge is
/// indistinguishable from "your contributions are gone", so a load failure has
/// to say so. The stream is created once in `initState`, so the honest recovery
/// is reopening the page rather than an in-place retry button.
class _ContributionError extends StatelessWidget {
  const _ContributionError();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'あなたの貢献',
          style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1E293B)),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            const Icon(Icons.cloud_off_rounded, size: 18, color: Color(0xFFCBD5E1)),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Text('読み込みに失敗しました',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF64748B))),
                  SizedBox(height: 2),
                  Text('通信環境を確認して、画面を開き直してください。',
                      style: TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
