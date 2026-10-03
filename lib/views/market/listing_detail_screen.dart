import 'package:firebase_storage/firebase_storage.dart' as fb_storage;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../models/textbook_listing.dart';
import '../../services/app_store.dart';
import '../../services/market_service.dart';
import '../textbook/talk_room_screen.dart';

const _brand = Color(0xFF0F4C81);

/// One listing (Plan 3): photos, the owner's rating summary (T-10), the
/// no-money notice, and the actions — chat (openListingChat), report (T-19),
/// share as text (T-22).
class ListingDetailScreen extends StatelessWidget {
  const ListingDetailScreen({super.key, required this.store, required this.listing});

  final AppStore store;
  final TextbookListing listing;

  void _notice(BuildContext context, String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _chat(BuildContext context) async {
    try {
      final roomId = await store.market.openChat(listing.id);
      if (!context.mounted || roomId.isEmpty) return;
      Navigator.push(context, MaterialPageRoute(builder: (_) => TalkRoomScreen(store: store, roomId: roomId)));
    } on MarketException catch (e) {
      if (context.mounted) _notice(context, e.notice);
    } catch (_) {
      if (context.mounted) _notice(context, 'チャットを開けませんでした。メール認証の状態と通信環境を確認してください。');
    }
  }

  Future<void> _report(BuildContext context) async {
    var category = ListingReportCategory.notTextbook;
    final detail = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('この出品を通報'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('3人以上から通報された出品は非表示になり、運営が確認します。', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 4, children: [
                for (final c in ListingReportCategory.values)
                  ChoiceChip(
                    label: Text(c.label, style: const TextStyle(fontSize: 12)),
                    selected: c == category,
                    onSelected: (_) => setLocal(() => category = c),
                  ),
              ]),
              TextField(controller: detail, maxLength: 500, decoration: const InputDecoration(hintText: '理由（任意）')),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('通報する')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final r = await store.market.reportListing(listing.id, category, detail.text);
      if (!context.mounted) return;
      _notice(context, switch (r) {
        MarketReportOutcome.duplicate => 'この出品はすでに通報済みです。',
        MarketReportOutcome.hidden || MarketReportOutcome.alreadyHidden => 'この出品は非表示になりました。運営が確認します。',
        _ => '通報を受け付けました。',
      });
    } on MarketException catch (e) {
      if (context.mounted) _notice(context, e.notice);
    } catch (_) {
      if (context.mounted) _notice(context, '通報を送信できませんでした。');
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = listing.ownerId == store.currentUser?.uid;
    final l = listing;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.type.label),
        actions: [
          IconButton(
            tooltip: 'シェア（テキストをコピー）',
            icon: const Icon(Icons.ios_share_rounded),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: listingShareText(l)));
              if (context.mounted) _notice(context, '紹介文をコピーしました。');
            },
          ),
          if (!mine)
            IconButton(tooltip: '通報', icon: const Icon(Icons.flag_outlined), onPressed: () => _report(context)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (l.photoPaths.isNotEmpty)
            SizedBox(
              height: 180,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [for (final p in l.photoPaths) _ListingPhoto(path: p)],
              ),
            ),
          const SizedBox(height: 12),
          Text('『${l.title}』', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
          const SizedBox(height: 6),
          Text(l.priceLabel, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: _brand)),
          if (l.listPrice != null) Text('定価 ¥${l.listPrice}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
          if (l.priceAboveList)
            const Text('※ 定価より高い価格です', style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
          const SizedBox(height: 12),
          if (l.courseName.isNotEmpty) Text('科目: ${l.courseName}'),
          if (l.condition != null) Text('状態: ${l.condition!.label}'),
          Text('受け渡し: ${l.placeLabel}'),
          if (l.description.isNotEmpty) ...[const SizedBox(height: 12), Text(l.description)],
          const SizedBox(height: 16),
          StreamBuilder<MarketProfile>(
            stream: store.market.streamProfile(l.ownerId),
            builder: (context, snap) {
              final p = snap.data ?? const MarketProfile();
              return Card(
                elevation: 0,
                child: ListTile(
                  leading: const Icon(Icons.verified_user_outlined, color: _brand),
                  title: Text('${l.ownerName}（認証済み京大生）'),
                  subtitle: Text(p.summary),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          const Text(
            'アプリはお金を扱いません。代金は受け渡しのときに直接やりとりしてください。人目のある場所・明るい時間の受け渡しをおすすめします。',
            style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
          ),
          const SizedBox(height: 20),
          if (!mine)
            SizedBox(
              height: 48,
              child: ElevatedButton.icon(
                onPressed: () => _chat(context),
                icon: const Icon(Icons.chat_bubble_outline_rounded),
                label: Text(l.type == ListingType.want ? '持っているので連絡する' : 'チャットで相談する'),
                style: ElevatedButton.styleFrom(backgroundColor: _brand, foregroundColor: Colors.white),
              ),
            ),
        ],
      ),
    );
  }
}

/// A listing photo: the download URL is asked for at display time (storage.rules
/// let any KU address read `listings/…`, T-5) and shown with an <img> element on
/// the web, so the bucket needs no CORS configuration.
class _ListingPhoto extends StatelessWidget {
  const _ListingPhoto({required this.path});

  final String path;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: FutureBuilder<String>(
          future: fb_storage.FirebaseStorage.instance.ref(path).getDownloadURL(),
          builder: (context, snap) => SizedBox(
            width: 180,
            child: snap.hasData
                ? Image.network(snap.data!, fit: BoxFit.cover, webHtmlElementStrategy: WebHtmlElementStrategy.prefer)
                : const ColoredBox(color: Color(0xFFE2E8F0), child: Icon(Icons.image_outlined, color: Color(0xFF94A3B8))),
          ),
        ),
      );
}
