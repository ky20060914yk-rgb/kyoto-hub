import 'package:cloud_firestore/cloud_firestore.dart';

/// One row of `notifications`, written only by Cloud Functions (Plan 2B, M-10).
/// The reader is total: a malformed row degrades instead of breaking the list.
/// It never says who reported, nor why — only what happened to the post.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.postId,
    required this.postTitle,
    required this.read,
    required this.createdAt,
    this.listingId = '',
  });

  final String id;
  final String type; // post_* (2B) | listing_match / listing_hidden / listing_restored / listing_removed (Plan 3)
  final String postId;
  final String postTitle; // the title of the post OR listing the notice is about
  final bool read;
  final DateTime createdAt;
  final String listingId; // Plan 3: set on listing_* notices

  String get message {
    final t = postTitle.isEmpty ? 'あなたの投稿' : '「$postTitle」';
    return switch (type) {
      'post_hidden' => '$tは、通報または権利者からの申し立てにより非表示になりました。運営が内容を確認します。獲得済みのクレジットはそのままです。',
      'post_restored' => '$tは、運営の確認の結果、再び表示されるようになりました。',
      'post_removed' => '$tは、運営の確認の結果、削除されました。獲得済みのクレジットはそのままです。',
      'listing_match' => '「買いたい」に合いそうな教科書$tが出品されました。教科書タブで確認してください。',
      'listing_hidden' => 'あなたの出品$tは、通報により非表示になりました。運営が内容を確認します。',
      'listing_restored' => 'あなたの出品$tは、運営の確認の結果、再び表示されるようになりました。',
      'listing_removed' => 'あなたの出品$tは、運営の確認の結果、削除されました。',
      _ => '$tについてのお知らせがあります。',
    };
  }

  static String _str(dynamic v) => v is String ? v : '';

  static DateTime _time(dynamic v) {
    if (v is Timestamp) return v.toDate();
    if (v is String) return DateTime.tryParse(v) ?? DateTime.fromMillisecondsSinceEpoch(0);
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  factory AppNotification.fromMap(String id, Map<String, dynamic> map) => AppNotification(
        id: id,
        type: _str(map['type']),
        postId: _str(map['postId']),
        postTitle: _str(map['postTitle']),
        read: map['read'] == true,
        createdAt: _time(map['createdAt']),
        listingId: _str(map['listingId']),
      );
}
