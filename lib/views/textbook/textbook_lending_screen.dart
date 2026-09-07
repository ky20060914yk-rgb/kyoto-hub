import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../../models/subject.dart';
import '../../models/textbook_request.dart';
import 'talk_room_screen.dart';

class TextbookLendingScreen extends StatefulWidget {
  final AppStore store;

  const TextbookLendingScreen({super.key, required this.store});

  @override
  State<TextbookLendingScreen> createState() => _TextbookLendingScreenState();
}

class _TextbookLendingScreenState extends State<TextbookLendingScreen> {
  Future<void> _showNewTextbookRequestModal() async {
    final registeredSubjects = await widget.store.getRegisteredSubjects();
    if (!mounted) return;
    if (registeredSubjects.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('まず時間割に科目を登録してください')),
      );
      return;
    }

    Subject selectedSubject = registeredSubjects.first;
    final bookTitleController = TextEditingController();

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
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('参考書リクエストを投稿', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('※貸し出しに応答があった時点で、一律 20pt が引き落とされます', style: TextStyle(fontSize: 12, color: Color(0xFFD97706))),
                  const SizedBox(height: 16),

                  // 1. Course Selection (Dropdown from registered timetable courses)
                  const Text('対象科目 (登録済み時間割より選択)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  const SizedBox(height: 6),
                  DropdownButtonFormField<Subject>(
                    value: selectedSubject,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: registeredSubjects
                        .map((s) => DropdownMenuItem(
                              value: s,
                              child: Text('${s.name} (${s.timeSlotLabel})', overflow: TextOverflow.ellipsis),
                            ))
                        .toList(),
                    onChanged: (val) {
                      if (val != null) setModalState(() => selectedSubject = val);
                    },
                  ),
                  const SizedBox(height: 16),

                  // 2. Book title input (Free text)
                  const Text('探している本のタイトル (自由入力)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  const SizedBox(height: 6),
                  TextField(
                    controller: bookTitleController,
                    decoration: const InputDecoration(
                      hintText: '例: チャート式 線形代数入門 (数研出版)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 20),

                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: ElevatedButton(
                      onPressed: () async {
                        if (bookTitleController.text.trim().isEmpty) return;
                        final messenger = ScaffoldMessenger.of(context);
                        final navigator = Navigator.of(context);
                        await widget.store.addTextbookRequest(
                          subjectId: selectedSubject.id,
                          bookTitle: bookTitleController.text.trim(),
                        );
                        navigator.pop();
                        if (mounted) setState(() {});
                        messenger.showSnackBar(
                          SnackBar(content: Text(widget.store.lastNoticeMessage ?? 'リクエストを作成しました')),
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0F4C81),
                        foregroundColor: Colors.white,
                      ),
                      child: const Text('リクエストを公開する', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
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

  @override
  Widget build(BuildContext context) {
    final requests = widget.store.textbookRequests;
    final talkRooms = widget.store.talkRooms;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: const Text(
          '参考書 貸し借り掲示板',
          style: TextStyle(color: Color(0xFF1E293B), fontWeight: FontWeight.bold),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Callout Banner
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFBFDBFE)),
              ),
              child: Row(
                children: const [
                  Icon(Icons.menu_book_rounded, color: Color(0xFF2563EB), size: 32),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('教科書・参考書の探索 & 譲渡', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1E40AF))),
                        SizedBox(height: 2),
                        Text('貸し手に応答があった時点で即座に一律 20pt 決済が行われ、受け渡し調整チャットが開設されます。', style: TextStyle(fontSize: 11, color: Color(0xFF3B82F6))),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Add Request Button
            SizedBox(
              width: double.infinity,
              height: 46,
              child: ElevatedButton.icon(
                onPressed: _showNewTextbookRequestModal,
                icon: const Icon(Icons.add_rounded),
                label: const Text('参考書をリクエストする', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0F4C81),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Active Talk Rooms (If matched)
            if (talkRooms.isNotEmpty) ...[
              const Text('進行中のトークルーム', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
              const SizedBox(height: 10),
              ...talkRooms.map((room) {
                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: Color(0xFF0F4C81), width: 1.5),
                  ),
                  child: ListTile(
                    leading: const Icon(Icons.chat_bubble_outline_rounded, color: Color(0xFF0F4C81)),
                    title: Text('『${room.bookTitle}』', style: const TextStyle(fontWeight: FontWeight.bold)),
                    subtitle: Text('科目: ${room.subjectName} • チャット件数: ${room.messages.length}'),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => TalkRoomScreen(store: widget.store, roomId: room.id),
                        ),
                      );
                    },
                  ),
                );
              }),
              const SizedBox(height: 20),
            ],

            // Requests Bulletin Board
            const Text('リクエスト一覧', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
            const SizedBox(height: 12),

            if (requests.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE2E8F0))),
                child: const Center(
                  child: Text('現在参考書リクエストはありません', style: TextStyle(color: Color(0xFF94A3B8))),
                ),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: requests.length,
                itemBuilder: (context, index) {
                  final req = requests[index];
                  final isMyRequest = req.requesterId == widget.store.currentUser?.uid;
                  final isMatched = req.status == TextbookRequestStatus.matched;

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
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: isMatched ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  isMatched ? 'マッチング済' : '募集中 (20pt)',
                                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  '『${req.bookTitle}』',
                                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text('対象科目: ${req.subjectName}', style: const TextStyle(fontSize: 13, color: Color(0xFF475569))),
                          const SizedBox(height: 4),
                          Text('求めている人: ${req.requesterName}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                          const SizedBox(height: 12),

                          if (isMatched) ...[
                            if (req.talkRoomId != null)
                              SizedBox(
                                width: double.infinity,
                                child: OutlinedButton.icon(
                                  onPressed: () {
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => TalkRoomScreen(store: widget.store, roomId: req.talkRoomId!),
                                      ),
                                    );
                                  },
                                  icon: const Icon(Icons.chat_rounded),
                                  label: const Text('トークルームを開く'),
                                ),
                              ),
                          ] else ...[
                            SizedBox(
                              width: double.infinity,
                              child: ElevatedButton(
                                onPressed: isMyRequest
                                    ? null
                                    : () {
                                        widget.store.respondToTextbookRequest(req);
                                        setState(() {});
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          SnackBar(content: Text(widget.store.lastNoticeMessage ?? '処理しました')),
                                        );
                                      },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF0F4C81),
                                  foregroundColor: Colors.white,
                                ),
                                child: Text(isMyRequest ? '自分の投稿です' : '本を貸す (即時20pt決済)'),
                              ),
                            ),
                          ],
                        ],
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
