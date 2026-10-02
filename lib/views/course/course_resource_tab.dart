import 'package:flutter/material.dart';

import '../../models/post.dart';
import '../../models/subject.dart';
import '../../services/app_store.dart';
import '../../utils/file_picker_helper.dart';

const _brand = Color(0xFF0F4C81);

/// 過去問・資料 tab on the course detail screen.
///
/// Task 8: this holds everything that used to live in
/// `course_detail_screen.dart` — the post/request feed, the upload modal, the
/// request modal, the download confirmation dialog and the report dialog.
///
/// The list is **category-agnostic**: the three [PostCategory] feeds are merged
/// into one `createdAt`-descending list and each card carries a small category
/// chip. The upload/request modals keep a category picker so posts are still
/// filed under a category (and the past-exam year/dedup/5pt-cost rules are
/// unchanged).
class CourseResourceTab extends StatefulWidget {
  const CourseResourceTab({super.key, required this.store, required this.subject});

  final AppStore store;
  final Subject subject;

  @override
  State<CourseResourceTab> createState() => _CourseResourceTabState();
}

class _CourseResourceTabState extends State<CourseResourceTab> {
  /// Every public post for this course, all categories, newest first.
  ///
  /// Response posts to a request (`requestId != null`) stay out of the public
  /// feed, exactly as before.
  List<Post> _allPosts() {
    final list = [
      for (final cat in PostCategory.values)
        ...widget.store.getPostsForSubject(widget.subject.id, cat),
    ].where((p) => p.requestId == null).toList();
    list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  Widget _categoryChip(PostCategory category) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Text(
        category.label,
        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: Color(0xFF475569)),
      ),
    );
  }

  /// Category picker used by both modals. [onChanged] receives the new value.
  Widget _categoryPicker(PostCategory selected, ValueChanged<PostCategory> onChanged) {
    return Wrap(
      spacing: 8,
      children: PostCategory.values.map((cat) {
        final isSelected = cat == selected;
        return ChoiceChip(
          label: Text(
            cat.label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: isSelected ? Colors.white : const Color(0xFF475569),
            ),
          ),
          selected: isSelected,
          showCheckmark: false,
          selectedColor: _brand,
          backgroundColor: const Color(0xFFF1F5F9),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: const BorderSide(color: Color(0xFFCBD5E1)),
          ),
          onSelected: (_) => onChanged(cat),
        );
      }).toList(),
    );
  }

  /// The read-only stand-in for [_categoryPicker] when the category is fixed
  /// (answering a request: the answer must match the request's own category).
  Widget _lockedCategoryChip(PostCategory category) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: _brand,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_outline, size: 13, color: Colors.white),
          const SizedBox(width: 5),
          Text(
            category.label,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
          ),
        ],
      ),
    );
  }

  void _showReportDialog(String postId) {
    final reasonController = TextEditingController();
    final contactController = TextEditingController(text: widget.store.currentUser?.email ?? '');

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.report_problem_outlined, color: Colors.redAccent),
            SizedBox(width: 8),
            Text('投稿の通報 (コンプライアンス)'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '著作権侵害や不適切なコンテンツの通報を受け付けています。（プロバイダ責任制限法対応）',
              style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: '通報の具体的な理由を入力してください',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: contactController,
              decoration: const InputDecoration(
                labelText: 'ご連絡先メールアドレス',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('キャンセル'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (reasonController.text.trim().isNotEmpty) {
                widget.store.submitInquiry(
                  category: 'report',
                  content: reasonController.text.trim(),
                  contactInfo: contactController.text.trim(),
                  targetPostId: postId,
                );

                await widget.store.reportPost(postId);

                if (mounted) {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(widget.store.lastNoticeMessage ?? '通報を送信しました。')),
                  );
                  setState(() {});
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white),
            child: const Text('通報を送信'),
          ),
        ],
      ),
    );
  }

  void _showAddPostModal(PostCategory initialCategory, {String? requestId, String? presetTitle}) {
    final titleController = TextEditingController(text: presetTitle);
    final descController = TextEditingController();
    List<String> selectedFiles = [];
    PickedFile? pickedFile;
    int selectedYear = DateTime.now().year;
    PostCategory category = initialCategory;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
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
                    Text('${category.label}を投稿する', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    const Text('資料を投稿すると、確認後に3クレジットが付与されます（1日の付与上限あり・重複資料は対象外）。', style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                    const SizedBox(height: 16),

                    // Category picker (was the tab selection before Task 8)
                    const Text('カテゴリ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    const SizedBox(height: 6),
                    // An answer to a request (`requestId != null`) must carry
                    // the request's own category, so the picker is locked.
                    if (requestId == null)
                      _categoryPicker(category, (cat) {
                        setModalState(() {
                          category = cat;
                        });
                      })
                    else
                      _lockedCategoryChip(category),
                    const SizedBox(height: 16),

                    if (category == PostCategory.pastExam) ...[
                      Row(
                        children: [
                          const Text('試験年度: ', style: TextStyle(fontWeight: FontWeight.bold)),
                          DropdownButton<int>(
                            value: selectedYear,
                            items: List.generate(25, (i) => DateTime.now().year - i)
                                .map((y) => DropdownMenuItem(value: y, child: Text('$y年度')))
                                .toList(),
                            onChanged: (val) {
                              if (val != null) setModalState(() => selectedYear = val);
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],

                    TextField(
                      controller: titleController,
                      decoration: const InputDecoration(
                        labelText: 'タイトル (必須)',
                        hintText: '例: 2024年度 中間試験問題',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descController,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: '資料の説明・出題傾向など',
                        hintText: '大問3の証明が難化、対面のメモ持ち込み不可など',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // File Selector
                    const Text('添付ファイル', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 6),
                    if (selectedFiles.isEmpty)
                      Container(
                        width: double.infinity,
                        height: 80,
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFCBD5E1), style: BorderStyle.solid),
                        ),
                        child: InkWell(
                          onTap: () async {
                            final file = await pickFile();
                            if (file != null) {
                              setModalState(() {
                                pickedFile = file;
                                selectedFiles = [file.name];
                              });
                            }
                          },
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: const [
                              Icon(Icons.upload_file_rounded, color: Color(0xFF64748B)),
                              SizedBox(height: 4),
                              Text('ファイルをアップロード (PDF / 画像のみ)', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            ],
                          ),
                        ),
                      )
                    else
                      Card(
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                          side: const BorderSide(color: Color(0xFFCBD5E1)),
                        ),
                        child: ListTile(
                          leading: const Icon(Icons.picture_as_pdf_rounded, color: Color(0xFFEF4444)),
                          title: Text(selectedFiles.first, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent, size: 20),
                            onPressed: () {
                              setModalState(() {
                                selectedFiles.clear();
                                pickedFile = null;
                              });
                            },
                          ),
                        ),
                      ),

                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: (titleController.text.trim().isEmpty || selectedFiles.isEmpty)
                              ? null
                              : () async {
                                  // Forbid duplicate past exams by year
                                  if (category == PostCategory.pastExam) {
                                    final isDuplicate = widget.store.posts.any((p) =>
                                        p.subjectId == widget.subject.id &&
                                        p.category == PostCategory.pastExam &&
                                        p.year == selectedYear);
                                    if (isDuplicate) {
                                      showDialog(
                                        context: context,
                                        builder: (context) => AlertDialog(
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                          title: const Text('重複エラー', style: TextStyle(fontWeight: FontWeight.bold)),
                                          content: Text('この科目の $selectedYear年度 の過去問は既に他ユーザーによって登録されています。重複した登録はできません。'),
                                          actions: [
                                            TextButton(
                                              onPressed: () => Navigator.pop(context),
                                              child: const Text('了解', style: TextStyle(color: _brand, fontWeight: FontWeight.bold)),
                                            ),
                                          ],
                                        ),
                                      );
                                      return;
                                    }
                                  }

                                  final messenger = ScaffoldMessenger.of(context);
                                  final navigator = Navigator.of(context);

                                  // Show spinner
                                  showDialog(
                                    context: context,
                                    barrierDismissible: false,
                                    builder: (context) => const Center(
                                      child: CircularProgressIndicator(),
                                    ),
                                  );

                                  final uploadedPath = await widget.store.uploadFileToStorage(
                                    pickedFile!.name,
                                    pickedFile!.bytes,
                                  );

                                  navigator.pop(); // Close spinner

                                  if (uploadedPath == null) {
                                    messenger.showSnackBar(
                                      SnackBar(content: Text(widget.store.lastNoticeMessage ?? 'ファイルのアップロードに失敗しました。')),
                                    );
                                    return;
                                  }

                                  final posted = await widget.store.addPost(
                                    subjectId: widget.subject.id,
                                    category: category,
                                    year: category == PostCategory.pastExam ? selectedYear : null,
                                    title: titleController.text.trim(),
                                    description: descController.text.trim(),
                                    fileNames: [pickedFile!.name],
                                    filePaths: [uploadedPath],
                                    requestId: requestId,
                                  );
                                  if (!posted) {
                                    // Rejected (e.g. by the rules): keep the form open, show why.
                                    messenger.showSnackBar(
                                      SnackBar(content: Text(widget.store.lastNoticeMessage ?? '投稿に失敗しました。')),
                                    );
                                    return;
                                  }
                                  navigator.pop();
                                  if (mounted) setState(() {});
                                  messenger.showSnackBar(
                                    SnackBar(content: Text(widget.store.lastNoticeMessage ?? '投稿を公開しました！')),
                                  );
                                },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _brand,
                            foregroundColor: Colors.white,
                          ),
                          child: const Text('投稿を公開する', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showAddRequestModal(PostCategory initialCategory) {
    final titleController = TextEditingController();
    final descController = TextEditingController();
    int selectedYear = DateTime.now().year;
    PostCategory category = initialCategory;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 20, right: 20, top: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('【${category.label}】のリクエスト投稿', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(
                      '※ リクエストは無料です。資料が投稿されると通知されます。',
                      style: TextStyle(fontSize: 11, color: Colors.grey[600]),
                    ),
                    const SizedBox(height: 16),

                    // Category picker (was the tab selection before Task 8)
                    const Text('カテゴリ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    const SizedBox(height: 6),
                    _categoryPicker(category, (cat) => setModalState(() => category = cat)),
                    const SizedBox(height: 16),

                    if (category == PostCategory.pastExam) ...[
                      Row(
                        children: [
                          const Text('欲しい年度: ', style: TextStyle(fontWeight: FontWeight.bold)),
                          DropdownButton<int>(
                            value: selectedYear,
                            items: List.generate(25, (i) => DateTime.now().year - i)
                                .map((y) => DropdownMenuItem(value: y, child: Text('$y年度')))
                                .toList(),
                            onChanged: (val) {
                              if (val != null) setModalState(() => selectedYear = val);
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],

                    TextField(
                      controller: titleController,
                      decoration: const InputDecoration(
                        labelText: 'リクエストタイトル',
                        hintText: '例: 2023年度の過去問をお持ちの方探しています',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descController,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: '詳細',
                        hintText: 'お探しの詳細や状況を入力',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),

                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: (titleController.text.trim().isEmpty)
                              ? null
                              : () async {
                                  final messenger = ScaffoldMessenger.of(context);
                                  final navigator = Navigator.of(context);
                                  final success = await widget.store.addMaterialRequest(
                                    subjectId: widget.subject.id,
                                    category: category,
                                    year: category == PostCategory.pastExam ? selectedYear : null,
                                    title: titleController.text.trim(),
                                    description: descController.text.trim(),
                                  );
                                  if (success) {
                                    navigator.pop();
                                    if (mounted) setState(() {});
                                    messenger.showSnackBar(
                                      SnackBar(content: Text(widget.store.lastNoticeMessage ?? 'リクエストを投稿しました！')),
                                    );
                                  } else {
                                    messenger.showSnackBar(
                                      SnackBar(content: Text(widget.store.lastNoticeMessage ?? 'リクエストの投稿に失敗しました。')),
                                    );
                                  }
                                },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _brand,
                            foregroundColor: Colors.white,
                          ),
                          child: const Text('リクエストを投稿する', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildDocumentPreviewThumbnail() {
    return Container(
      height: 120,
      width: 85,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFCBD5E1)),
        boxShadow: [
          BoxShadow(color: Colors.black.withAlpha(5), blurRadius: 4, offset: const Offset(0, 2)),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Stack(
          children: [
            // Mock exam paper layout lines
            Padding(
              padding: const EdgeInsets.all(6.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(height: 5, width: 30, color: Colors.grey[300]),
                  const SizedBox(height: 4),
                  Container(height: 3, width: 50, color: Colors.grey[200]),
                  const SizedBox(height: 10),
                  // Question 1
                  Container(height: 4, width: 20, color: Colors.grey[300]),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Container(height: 2, width: 6, color: Colors.grey[200]),
                      const SizedBox(width: 3),
                      Container(height: 2, width: 25, color: Colors.grey[200]),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Container(height: 2, width: 6, color: Colors.grey[200]),
                      const SizedBox(width: 3),
                      Container(height: 2, width: 35, color: Colors.grey[200]),
                    ],
                  ),
                  const SizedBox(height: 8),
                  // Question 2
                  Container(height: 4, width: 20, color: Colors.grey[300]),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Container(height: 2, width: 6, color: Colors.grey[200]),
                      const SizedBox(width: 3),
                      Container(height: 2, width: 30, color: Colors.grey[200]),
                    ],
                  ),
                ],
              ),
            ),
            // Blurred overlay
            Positioned.fill(
              child: Container(
                color: Colors.white.withAlpha(120),
              ),
            ),
            // Diagonal SAMPLE text
            Positioned.fill(
              child: Center(
                child: RotationTransition(
                  turns: const AlwaysStoppedAnimation(-30 / 360),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    decoration: BoxDecoration(
                      border: Border.all(color: const Color(0xFFEF4444).withAlpha(150), width: 1),
                      borderRadius: BorderRadius.circular(4),
                      color: const Color(0xFFFEF2F2).withAlpha(180),
                    ),
                    child: const Text(
                      'SAMPLE\nPREVIEW',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Color(0xFFEF4444),
                        fontSize: 7.5,
                        fontWeight: FontWeight.bold,
                        height: 1.1,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showDownloadConfirmDialog(Post post) {
    bool isFree = false;
    final curUid = widget.store.currentUser?.uid;
    if (post.authorId == curUid) {
      isFree = true;
    } else {
      final isRequester = widget.store.requests.any((r) => r.fulfilledPostId == post.id && r.authorId == curUid);
      if (isRequester) {
        isFree = true;
      }
    }

    final balance = widget.store.creditBalance;
    final canPay = isFree || balance >= 1;
    final noFile = post.filePaths.isEmpty; // un-migrated legacy post

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: const [
              Icon(Icons.download_for_offline_rounded, color: _brand, size: 24),
              SizedBox(width: 8),
              Text('ダウンロードの確認', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(post.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1E293B))),
                    if (post.description.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(post.description, style: const TextStyle(fontSize: 12, color: Color(0xFF475569))),
                    ],
                    const SizedBox(height: 6),
                    Text('アップロード者: ${post.authorName}', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildDocumentPreviewThumbnail(),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('含まれるファイル一覧:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Color(0xFF334155))),
                        const SizedBox(height: 6),
                        ...post.fileNames.map((fn) => Padding(
                              padding: const EdgeInsets.only(bottom: 4.0),
                              child: Row(
                                children: [
                                  Icon(
                                    fn.toLowerCase().endsWith('.pdf') ? Icons.picture_as_pdf_rounded : Icons.insert_drive_file_outlined,
                                    size: 14,
                                    color: const Color(0xFF64748B),
                                  ),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      fn,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF475569)),
                                    ),
                                  ),
                                ],
                              ),
                            )),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),

              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: isFree
                      ? const Color(0xFFECFDF5)
                      : (canPay ? const Color(0xFFEFF6FF) : const Color(0xFFFEF2F2)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(
                      isFree ? Icons.check_circle_outline_rounded : (canPay ? Icons.stars_rounded : Icons.info_outline_rounded),
                      color: isFree ? const Color(0xFF10B981) : (canPay ? const Color(0xFF2563EB) : const Color(0xFFEF4444)),
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            noFile
                                ? 'この資料は移行中のためダウンロードできません'
                                : isFree
                                    ? 'あなたは無料でダウンロードできます！'
                                    : '1クレジットを消費します（保有: $balanceクレジット）',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: isFree
                                  ? const Color(0xFF065F46)
                                  : (canPay ? const Color(0xFF1E40AF) : const Color(0xFF991B1B)),
                            ),
                          ),
                          if (!noFile && !isFree && balance < 1)
                            const Text(
                              'クレジットが足りません。',
                              style: TextStyle(fontSize: 10, color: Color(0xFF991B1B)),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('キャンセル', style: TextStyle(color: Colors.grey)),
            ),
            ElevatedButton(
              onPressed: (noFile || !canPay)
                  ? null
                  : () async {
                      final messenger = ScaffoldMessenger.of(context);
                      Navigator.pop(context);
                      final ok = await widget.store.downloadPost(post);
                      if (!mounted) return;
                      setState(() {});
                      messenger.showSnackBar(SnackBar(
                          content: Text(widget.store.lastNoticeMessage ??
                              (ok ? 'ダウンロードを開始しました。' : 'エラーが発生しました。'))));
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: _brand,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: Text(
                isFree ? '無料でダウンロード' : 'ダウンロードする',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final postsList = _allPosts();
    final requestsList = [
      for (final cat in PostCategory.values)
        ...widget.store.getRequestsForSubject(widget.subject.id, cat),
    ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Action Buttons Header
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () => _showAddPostModal(PostCategory.pastExam),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('資料を投稿'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _brand,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _showAddRequestModal(PostCategory.pastExam),
                  icon: const Icon(Icons.help_outline_rounded, size: 18),
                  label: const Text('資料をリクエスト'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _brand,
                    side: const BorderSide(color: _brand),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Requests Area
          if (requestsList.isNotEmpty) ...[
            const Text('募集中のリクエスト', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(height: 10),
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: requestsList.length,
              itemBuilder: (context, index) {
                final req = requestsList[index];
                final isMyRequest = req.authorId == widget.store.currentUser?.uid;

                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  elevation: 0,
                  color: req.isFulfilled ? const Color(0xFFF1F5F9) : const Color(0xFFEFF6FF),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: BorderSide(color: req.isFulfilled ? const Color(0xFFCBD5E1) : const Color(0xFFBFDBFE)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(14.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (req.year != null) ...[
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: req.isFulfilled ? const Color(0xFF64748B) : const Color(0xFF2563EB),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text('${req.year}年度', style: const TextStyle(color: Colors.white, fontSize: 11)),
                              ),
                              const SizedBox(width: 8),
                            ],
                            Expanded(
                              child: Text(
                                req.title,
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14.5,
                                  decoration: req.isFulfilled ? TextDecoration.lineThrough : null,
                                  color: req.isFulfilled ? const Color(0xFF64748B) : Colors.black87,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        _categoryChip(req.category),
                        if (req.description.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(
                            req.description,
                            style: TextStyle(fontSize: 12, color: req.isFulfilled ? const Color(0xFF94A3B8) : const Color(0xFF334155)),
                          ),
                        ],
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '投稿者: ${req.authorName} ${isMyRequest ? " (あなた)" : ""}',
                              style: const TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                            ),
                            if (req.isFulfilled) ...[
                              Row(
                                children: [
                                  const Icon(Icons.check_circle_rounded, color: Colors.green, size: 14),
                                  const SizedBox(width: 4),
                                  const Text('解決済み', style: TextStyle(fontSize: 11, color: Colors.green, fontWeight: FontWeight.bold)),

                                  // Open private material link
                                  ...(() {
                                    final curUid = widget.store.currentUser?.uid;
                                    final post = widget.store.posts.any((p) => p.id == req.fulfilledPostId)
                                        ? widget.store.posts.firstWhere((p) => p.id == req.fulfilledPostId)
                                        : null;
                                    final canAccess = post != null && (req.authorId == curUid || post.authorId == curUid);

                                    if (canAccess) {
                                      return [
                                        const SizedBox(width: 8),
                                        TextButton.icon(
                                          onPressed: () => _showDownloadConfirmDialog(post),
                                          icon: const Icon(Icons.download_rounded, size: 11),
                                          label: const Text('回答された資料を見る', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold)),
                                          style: TextButton.styleFrom(
                                            foregroundColor: _brand,
                                            padding: EdgeInsets.zero,
                                            minimumSize: Size.zero,
                                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                          ),
                                        )
                                      ];
                                    }
                                    return <Widget>[];
                                  })()
                                ],
                              )
                            ] else if (!isMyRequest)
                              ElevatedButton.icon(
                                onPressed: () {
                                  _showAddPostModal(
                                    req.category,
                                    requestId: req.id,
                                    presetTitle: '【リクエスト回答】${req.title}',
                                  );
                                },
                                icon: const Icon(Icons.upload_file_rounded, size: 12),
                                label: const Text('資料を提供', style: TextStyle(fontSize: 11)),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFFD97706),
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
              },
            ),
            const SizedBox(height: 20),
          ],

          // Public Feed Section
          const Text('登録済みの資料', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
          const SizedBox(height: 10),
          if (postsList.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: const Center(
                child: Text('まだこの科目の資料はありません。最初の投稿者になりましょう！', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
              ),
            )
          else
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: postsList.length,
              itemBuilder: (context, index) {
                final post = postsList[index];
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (post.year != null) ...[
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _brand,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '${post.year}年度',
                                  style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                                ),
                              ),
                              const SizedBox(width: 8),
                            ],
                            Expanded(
                              child: Text(
                                post.title,
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.flag_outlined, size: 18, color: Colors.grey),
                              onPressed: () => _showReportDialog(post.id),
                              tooltip: '通報する',
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        _categoryChip(post.category),
                        if (post.description.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(post.description, style: const TextStyle(fontSize: 13, color: Color(0xFF475569))),
                        ],
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            const Icon(Icons.person_outline, size: 14, color: Color(0xFF64748B)),
                            const SizedBox(width: 4),
                            Text(post.authorName, style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            const SizedBox(width: 16),
                            const Icon(Icons.download_rounded, size: 14, color: Color(0xFF64748B)),
                            const SizedBox(width: 4),
                            Text('${post.downloadCount} DL', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                            const Spacer(),
                            ElevatedButton(
                              onPressed: () => _showDownloadConfirmDialog(post),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFD97706),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                              ),
                              child: Text(
                                post.authorId == widget.store.currentUser?.uid ||
                                        widget.store.requests.any((r) => r.fulfilledPostId == post.id && r.authorId == widget.store.currentUser?.uid)
                                    ? '無料'
                                    : '1クレジット',
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}
