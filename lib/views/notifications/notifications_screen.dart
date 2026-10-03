import 'package:flutter/material.dart';

import '../../models/app_notification.dart';
import '../../services/app_store.dart';
import '../market/listing_detail_screen.dart';

/// お知らせ (Plan 2B, M-10): the moderation notices the Functions write for the
/// signed-in user, and (Plan 3) the market notices — a match for a 買いたい, a
/// listing hidden / restored / removed. Opening the screen marks them read.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    widget.store.addListener(_onStore);
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.store.markNotificationsRead());
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStore);
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  static String _two(int v) => v.toString().padLeft(2, '0');
  static String _when(DateTime d) => '${d.year}/${_two(d.month)}/${_two(d.day)} ${_two(d.hour)}:${_two(d.minute)}';

  IconData _icon(AppNotification n) => switch (n.type) {
        'post_hidden' => Icons.visibility_off_outlined,
        'post_restored' => Icons.visibility_outlined,
        'post_removed' => Icons.delete_outline_rounded,
        'listing_match' => Icons.menu_book_rounded,
        'listing_hidden' => Icons.visibility_off_outlined,
        'listing_restored' => Icons.visibility_outlined,
        'listing_removed' => Icons.delete_outline_rounded,
        _ => Icons.notifications_none_rounded,
      };

  /// Plan 3: a match notice opens the listing it is about (if it is still there).
  Future<void> _open(AppNotification n) async {
    if (n.type != 'listing_match' || n.listingId.isEmpty) return;
    final listing = await widget.store.market.getListing(n.listingId).catchError((_) => null);
    if (!mounted) return;
    if (listing == null || !listing.isLive(DateTime.now())) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('この出品はもう掲載されていません。')));
      return;
    }
    Navigator.push(context, MaterialPageRoute(builder: (_) => ListingDetailScreen(store: widget.store, listing: listing)));
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.store.notifications;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(title: const Text('お知らせ')),
      body: items.isEmpty
          ? const Center(child: Text('お知らせはまだありません', style: TextStyle(color: Color(0xFF94A3B8))))
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final n = items[i];
                return Card(
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  child: ListTile(
                    onTap: () => _open(n),
                    leading: Icon(_icon(n), color: const Color(0xFF0F4C81)),
                    title: Text(
                      n.message,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: n.read ? FontWeight.normal : FontWeight.bold,
                        color: const Color(0xFF1E293B),
                      ),
                    ),
                    subtitle: Text(_when(n.createdAt.toLocal()),
                        style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                  ),
                );
              },
            ),
    );
  }
}
