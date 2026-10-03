import 'package:flutter/material.dart';

import '../../models/subject.dart';
import '../../models/textbook_listing.dart';
import '../../services/app_store.dart';
import '../../services/market_service.dart';
import '../textbook/talk_room_screen.dart';
import 'listing_detail_screen.dart';
import 'listing_form_screen.dart';

const _brand = Color(0xFF0F4C81);

/// 教科書 tab (Plan 3, spec §4.1/§4.4): さがす (live listings, course filter,
/// free words, type chips), トーク (my rooms, unread first-class), 自分の出品
/// (renew / close, the 「まだ有効?」 prompt — T-8).
class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  final _query = TextEditingController();
  ListingType? _type;
  String _courseId = '';
  List<Subject> _courses = const [];
  late Stream<List<TextbookListing>> _listings = widget.store.market.streamListings();
  late final Stream<List<TextbookListing>> _mine = widget.store.market.streamMyListings(widget.store.currentUser?.uid ?? '');

  AppStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    store.addListener(_onStore);
    _query.addListener(_onStore);
    store.getRegisteredSubjects().then((c) {
      if (mounted) setState(() => _courses = c);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    store.removeListener(_onStore);
    _query.dispose();
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  void _setCourse(String id) => setState(() {
        _courseId = id;
        _listings = store.market.streamListings(courseId: id);
      });

  void _notice(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _newListing() async {
    final created = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ListingFormScreen(store: store)));
    if (created == true && mounted) _notice('出品しました。30日間掲載されます。');
  }

  Future<void> _act(Future<void> Function() call, String done) async {
    try {
      await call();
      if (mounted) _notice(done);
    } on MarketException catch (e) {
      if (mounted) _notice(e.notice);
    } catch (_) {
      if (mounted) _notice('処理に失敗しました。');
    }
  }

  Widget _card(TextbookListing l, {Widget? trailing, String? status}) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        child: ListTile(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ListingDetailScreen(store: store, listing: l))),
          leading: CircleAvatar(
            backgroundColor: const Color(0xFFEFF6FF),
            child: Text(l.type.label.substring(0, 1), style: const TextStyle(color: _brand, fontWeight: FontWeight.bold)),
          ),
          title: Text('『${l.title}』', style: const TextStyle(fontWeight: FontWeight.bold)),
          subtitle: Text([
            l.type.label,
            l.priceLabel,
            if (l.courseName.isNotEmpty) l.courseName,
            l.placeLabel,
            ?status,
          ].join(' ・ ')),
          trailing: trailing,
        ),
      );

  Widget _searchTab() => StreamBuilder<List<TextbookListing>>(
        stream: _listings,
        builder: (context, snap) {
          final shown = filterListings(snap.data ?? const [], type: _type, query: _query.text);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                '京大生どうしで教科書を譲る・売る・探す掲示板です。アプリはお金を扱いません（代金は受け渡し時に直接）。教科書・参考書以外の出品は禁止です。',
                style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _query,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search_rounded),
                  hintText: '本のタイトル・科目名でさがす',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 4, children: [
                ChoiceChip(label: const Text('すべて'), selected: _type == null, onSelected: (_) => setState(() => _type = null)),
                for (final t in ListingType.values)
                  ChoiceChip(label: Text(t.label), selected: _type == t, onSelected: (_) => setState(() => _type = t)),
              ]),
              if (_courses.isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  ChoiceChip(label: const Text('全科目'), selected: _courseId.isEmpty, onSelected: (_) => _setCourse('')),
                  for (final c in _courses)
                    ChoiceChip(label: Text(c.name), selected: _courseId == c.id, onSelected: (_) => _setCourse(c.id)),
                ]),
              ],
              const SizedBox(height: 12),
              if (snap.connectionState == ConnectionState.waiting && !snap.hasData)
                const Center(child: CircularProgressIndicator())
              else if (shown.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('該当する出品はありません', style: TextStyle(color: Color(0xFF94A3B8)))),
                )
              else
                for (final l in shown) _card(l),
            ],
          );
        },
      );

  Widget _roomsTab() {
    final me = store.currentUser?.uid ?? '';
    final rooms = store.talkRooms;
    if (rooms.isEmpty) {
      return const Center(child: Text('まだトークはありません', style: TextStyle(color: Color(0xFF94A3B8))));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final r in rooms)
          Card(
            elevation: 0,
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Badge(
                isLabelVisible: r.isUnreadFor(me),
                child: const Icon(Icons.chat_bubble_outline_rounded, color: _brand),
              ),
              title: Text('『${r.bookTitle}』 ${r.otherName(me)} さん', style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text(r.isClosed ? '終了したトーク' : (r.lastMessageText.isEmpty ? 'メッセージはまだありません' : r.lastMessageText),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TalkRoomScreen(store: store, roomId: r.id))),
            ),
          ),
      ],
    );
  }

  Widget _mineTab() {
    return StreamBuilder<List<TextbookListing>>(
      stream: _mine,
      builder: (context, snap) {
        final mine = snap.data ?? const <TextbookListing>[];
        final now = DateTime.now();
        if (mine.isEmpty) {
          return const Center(child: Text('出品はまだありません', style: TextStyle(color: Color(0xFF94A3B8))));
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final l in mine)
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (l.canRenew(now))
                    Container(
                      padding: const EdgeInsets.all(10),
                      color: const Color(0xFFFFFBEB),
                      child: Row(children: [
                        Expanded(
                          child: Text(
                            l.isLive(now) ? '『${l.title}』はまだ有効ですか？ まもなく掲載が終わります。' : '『${l.title}』の掲載期限が切れました。',
                            style: const TextStyle(fontSize: 12, color: Color(0xFF92400E)),
                          ),
                        ),
                        TextButton(
                          onPressed: () => _act(() => store.market.renewListing(l.id), '掲載を30日延長しました。'),
                          child: const Text('延長する'),
                        ),
                      ]),
                    ),
                  _card(
                    l,
                    status: switch (l.status) {
                      'active' => l.isLive(now) ? '掲載中' : '期限切れ',
                      'hidden' => '非表示（運営確認中）',
                      _ => '取り下げ済み',
                    },
                    trailing: l.status == 'active'
                        ? TextButton(
                            onPressed: () => _act(() => store.market.closeListing(l.id), '出品を取り下げました。'),
                            child: const Text('取り下げ'),
                          )
                        : null,
                  ),
                ],
              ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final unread = store.unreadRoomCount;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('教科書'),
          bottom: TabBar(
            labelColor: _brand,
            tabs: [
              const Tab(text: 'さがす'),
              Tab(child: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Text('トーク'))),
              const Tab(text: '自分の出品'),
            ],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _newListing,
          backgroundColor: _brand,
          foregroundColor: Colors.white,
          icon: const Icon(Icons.add_rounded),
          label: const Text('出品する'),
        ),
        body: TabBarView(children: [_searchTab(), _roomsTab(), _mineTab()]),
      ),
    );
  }
}
