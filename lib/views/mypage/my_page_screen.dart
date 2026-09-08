import 'dart:async';

import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../../models/post.dart';
import '../../models/review.dart';
import '../auth/signup_screen.dart';
import '../course/review_form_sheet.dart';
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

  void _showPointExplanationDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: const [
              Icon(Icons.stars_rounded, color: Color(0xFFFBBF24), size: 24),
              SizedBox(width: 8),
              Text('ポイント制度のルール', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('京大InfoHubでは、良質な資料を共有し合うコミュニティを維持するため、以下のポイント制度を採用しています。', style: TextStyle(fontSize: 12.5, color: Color(0xFF475569))),
                const SizedBox(height: 12),
                _buildRuleSection('獲得する', [
                  '👤 メール認証完了ボーナス: +30 pt',
                  '✉️ 招待コード経由での登録: 双方に +10 pt',
                  '📤 過去問のアップロード: +5 pt\n(※2021年以降のもの。1日3回まで付与)',
                  '🎁 ダウンロードマイルストーン:\n 自分の資料が 5DL されると +5 pt\n 自分の資料が 10DL されると +10 pt',
                  '🤝 リクエストの解決: 依頼者が設定した報酬ptを獲得',
                  '🪙 資料DLロイヤリティ: 自分の資料がDLされるたびに、消費ポイントの80%が即座に還元 (例: 過去問なら +4 pt)',
                ], const Color(0xFF10B981)),
                const SizedBox(height: 12),
                _buildRuleSection('消費する', [
                  '📄 過去問 of ダウンロード: 5 pt',
                  '💡 テスト対策資料などのDL: 0 〜 20 pt',
                  '❓ 過去問リクエストの作成: 1 pt ＋ 任意の設定報酬pt',
                  '🎁 リクエスト依頼者特典: 自分のリクエストに回答された資料は無料でDLできます！',
                ], const Color(0xFFEF4444)),
                const SizedBox(height: 12),
                _buildRuleSection('その他の制限', [
                  '⚠️ 古い過去問 (2020年以前): アップロード時の+5ptは付与されません (DLロイヤリティとマイルストーン報酬のみ対象)。',
                  '⚠️ 同一年度の重複禁止: 同一科目の同じ年度の過去問は、重複してアップロードできません。',
                  '⚠️ 通報ペナルティ: 転載や無関係なアップロードが3回通報されると自動削除され、獲得ポイントが全額没収されます。',
                ], const Color(0xFF64748B)),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('閉じる', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F4C81))),
            ),
          ],
        );
      },
    );
  }

  Widget _buildRuleSection(String title, List<String> rules, Color badgeColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: badgeColor.withAlpha(20),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            title,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: badgeColor),
          ),
        ),
        const SizedBox(height: 6),
        ...rules.map((rule) => Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 4),
              child: Text(
                rule,
                style: const TextStyle(fontSize: 11.5, color: Color(0xFF334155), height: 1.35),
              ),
            )),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.store.currentUser;
    final myPosts = user != null
        ? widget.store.posts.where((p) => p.authorId == user.uid).toList()
        : <Post>[];
    final txs = widget.store.transactions;

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
                              const Text('保有ポイント残高', style: TextStyle(color: Colors.white70, fontSize: 12)),
                              const SizedBox(height: 4),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.baseline,
                                textBaseline: TextBaseline.alphabetic,
                                children: [
                                  Text(
                                    '${user?.points ?? 0}',
                                    style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold),
                                  ),
                                  const SizedBox(width: 4),
                                  const Text('pt', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
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
                                child: const Text('過去問 約6年分相当', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                              ),
                              const SizedBox(height: 6),
                              const Text('有効期限: 発行から12ヶ月', style: TextStyle(color: Colors.white70, fontSize: 10)),
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
                          Text('あなたの招待コード: ${user?.invitationCode ?? ''}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          const Spacer(),
                          const Text('招待時 +10pt', style: TextStyle(fontSize: 11, color: Color(0xFF0F4C81), fontWeight: FontWeight.bold)),
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
                    onPressed: _showPointExplanationDialog,
                    icon: const Icon(Icons.help_outline_rounded, size: 18),
                    label: const Text('ポイント制度解説', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold)),
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
                          Text('${p.downloadCost}pt', style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFD97706))),
                          const SizedBox(width: 4),
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
            const Text('ポイント取引・獲得履歴', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(height: 10),
            if (txs.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE2E8F0))),
                child: const Center(child: Text('取引履歴はありません。', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13))),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: txs.length,
                itemBuilder: (context, index) {
                  final tx = txs[index];
                  final isPlus = tx.amount >= 0;

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
                      title: Text(tx.description, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                      subtitle: Text('${tx.createdAt.month}/${tx.createdAt.day} ${tx.createdAt.hour}:${tx.createdAt.minute.toString().padLeft(2, '0')}'),
                      trailing: Text(
                        '${isPlus ? "+" : ""}${tx.amount} pt',
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
          ],
        ),
      ),
    );
  }
}
