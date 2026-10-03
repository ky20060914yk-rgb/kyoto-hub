import 'package:flutter/material.dart';

import '../../models/talk_room.dart';
import '../../services/app_store.dart';
import '../../services/chat_service.dart';
import '../../services/market_service.dart';

const _brand = Color(0xFF0F4C81);

/// A two-party chat (Plan 3, spec §4.5.5): the newest page live, older pages on
/// demand, names from the room (never from a message), the no-money warning,
/// and the safety tools — rate the deal (T-10), report harassment or a failed
/// handoff (T-20), block (T-17).
class TalkRoomScreen extends StatefulWidget {
  const TalkRoomScreen({super.key, required this.store, required this.roomId});

  final AppStore store;
  final String roomId;

  @override
  State<TalkRoomScreen> createState() => _TalkRoomScreenState();
}

class _TalkRoomScreenState extends State<TalkRoomScreen> {
  final _text = TextEditingController();
  late final Stream<List<ChatMessage>> _latest = widget.store.chat.streamLatest(widget.roomId);
  List<ChatMessage> _older = const [];
  bool _loadingOlder = false;
  bool _noMoreOlder = false;
  bool _sending = false;

  AppStore get store => widget.store;
  String get _me => store.currentUser?.uid ?? '';

  TalkRoom? get _room {
    for (final r in store.talkRooms) {
      if (r.id == widget.roomId) return r;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    store.addListener(_onStore);
    _text.addListener(_onStore);
  }

  @override
  void dispose() {
    store.removeListener(_onStore);
    _text.dispose();
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  void _notice(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  void _markReadIfNeeded(TalkRoom room) {
    if (room.isUnreadFor(_me)) store.chat.markRead(room, _me).catchError((_) {});
  }

  Future<void> _loadOlder(DateTime before) async {
    setState(() => _loadingOlder = true);
    try {
      final page = await store.chat.loadOlder(widget.roomId, before);
      if (!mounted) return;
      setState(() {
        _older = [...page, ..._older];
        _noMoreOlder = page.length < ChatService.pageSize;
      });
    } catch (_) {
      _notice('過去のメッセージを読み込めませんでした。');
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  Future<void> _send(TalkRoom room) async {
    final text = _text.text;
    if (text.trim().isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      if (await store.chat.send(room.id, _me, text)) _text.clear();
    } catch (_) {
      _notice('送信できませんでした。メール認証の状態と通信環境を確認してください。');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _rate(TalkRoom room) async {
    var stars = 5;
    final comment = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('取引を評価する'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${room.otherName(_me)} さんとの取引はいかがでしたか？', style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 8),
              Wrap(spacing: 6, children: [
                for (var s = 1; s <= 5; s++)
                  ChoiceChip(label: Text('★$s'), selected: stars == s, onSelected: (_) => setLocal(() => stars = s)),
              ]),
              TextField(
                controller: comment,
                maxLength: kRatingMaxComment,
                decoration: const InputDecoration(hintText: 'ひとこと（任意）'),
              ),
              const Text('評価は取り消せません。お互いが評価するか14日たつと公開されます。',
                  style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('送信')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final rated = await store.market.rateDeal(room.id, stars, comment.text);
      _notice(rated ? '評価を送信しました。' : 'この取引はすでに評価済みです。');
    } on MarketException catch (e) {
      _notice(e.notice);
    } catch (_) {
      _notice('評価を送信できませんでした。');
    }
  }

  Future<void> _report(TalkRoom room) async {
    var category = RoomReportCategory.noShow;
    final detail = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('運営に報告する'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Wrap(spacing: 6, runSpacing: 4, children: [
                  for (final c in RoomReportCategory.values)
                    ChoiceChip(
                      label: Text(c.label, style: const TextStyle(fontSize: 12)),
                      selected: c == category,
                      onSelected: (_) => setLocal(() => category = c),
                    ),
                ]),
                TextField(
                  controller: detail,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: const InputDecoration(hintText: '状況（任意）'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('報告する')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final r = await store.market.reportRoom(room.id, category, detail.text);
      _notice(r == MarketReportOutcome.duplicate ? 'すでに報告済みです。運営の対応をお待ちください。' : '運営に報告しました。確認して対応します。');
    } on MarketException catch (e) {
      _notice(e.notice);
    } catch (_) {
      _notice('報告を送信できませんでした。');
    }
  }

  Future<void> _block(TalkRoom room) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ブロックしますか？'),
        content: Text('${room.otherName(_me)} さんとのトークを終了し、今後この相手とはやりとりできなくなります。元に戻せません。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ブロック')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await store.market.blockRoom(room.id);
      _notice('ブロックしました。');
    } on MarketException catch (e) {
      _notice(e.notice);
    } catch (_) {
      _notice('ブロックできませんでした。');
    }
  }

  Widget _bubble(TalkRoom room, ChatMessage m) {
    final mine = m.senderId == _me;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: mine ? _brand : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: mine ? null : Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(room.nameOf(m.senderId),
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: mine ? Colors.white70 : const Color(0xFF64748B))),
            const SizedBox(height: 4),
            Text(m.text, style: TextStyle(fontSize: 14, color: mine ? Colors.white : const Color(0xFF1E293B))),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final room = _room;
    if (room == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('トーク')),
        // A room just opened by openListingChat arrives through the participant
        // stream within a moment; a room the user is not part of never does.
        body: const Center(child: Text('トークルームを読み込んでいます…', style: TextStyle(color: Color(0xFF94A3B8)))),
      );
    }
    final warnContact = containsContactInfo(_text.text);
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('『${room.bookTitle}』', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16), overflow: TextOverflow.ellipsis),
            Text('${room.otherName(_me)} さんとのトーク', style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) => switch (v) {
              'rate' => _rate(room),
              'report' => _report(room),
              _ => _block(room),
            },
            itemBuilder: (_) => [
              if (!room.isLegacy && room.bothSpoke) const PopupMenuItem(value: 'rate', child: Text('取引を評価する')),
              const PopupMenuItem(value: 'report', child: Text('受け渡し不履行・トラブルを報告')),
              if (!room.isClosed) const PopupMenuItem(value: 'block', child: Text('ブロックする')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: const Color(0xFFFEF2F2),
            child: Text(room.warningNotice,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFB91C1C))),
          ),
          if (room.isClosed)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              color: const Color(0xFFF1F5F9),
              child: const Text('このトークは終了しています（ブロック）。新しいメッセージは送れません。',
                  style: TextStyle(fontSize: 12, color: Color(0xFF475569))),
            ),
          Expanded(
            child: StreamBuilder<List<ChatMessage>>(
              stream: _latest,
              builder: (context, snap) {
                final latest = snap.data ?? const <ChatMessage>[];
                WidgetsBinding.instance.addPostFrameCallback((_) => _markReadIfNeeded(room));
                final seen = <String>{};
                final all = [..._older, ...latest].where((m) => seen.add(m.id)).toList();
                final canLoadOlder = !_noMoreOlder && latest.length >= ChatService.pageSize && all.isNotEmpty;
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (canLoadOlder)
                      Center(
                        child: TextButton(
                          onPressed: _loadingOlder ? null : () => _loadOlder(all.first.createdAt),
                          child: const Text('以前のメッセージを読み込む'),
                        ),
                      ),
                    if (all.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 24),
                        child: Center(
                          child: Text('受け渡しの場所と日時を相談しましょう。', style: TextStyle(color: Color(0xFF94A3B8))),
                        ),
                      ),
                    for (final m in all) _bubble(room, m),
                  ],
                );
              },
            ),
          ),
          if (!room.isClosed)
            SafeArea(
              child: Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (warnContact)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 4),
                        child: Text('電話番号・メールアドレス・LINE IDなどの連絡先は、なるべく送らないでください。',
                            style: TextStyle(fontSize: 11, color: Color(0xFFB45309))),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _text,
                            maxLength: kChatMaxMessage,
                            decoration: const InputDecoration(
                              hintText: '受け渡し場所・日時をメッセージ…',
                              counterText: '',
                              border: OutlineInputBorder(),
                              isDense: true,
                            ),
                            onSubmitted: (_) => _send(room),
                          ),
                        ),
                        IconButton(
                          tooltip: '送信',
                          icon: const Icon(Icons.send_rounded, color: _brand),
                          onPressed: _sending ? null : () => _send(room),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
