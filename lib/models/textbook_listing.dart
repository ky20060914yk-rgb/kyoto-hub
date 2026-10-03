import 'package:cloud_firestore/cloud_firestore.dart';

/// Wire values must equal `LISTING_TYPES` in functions/src/marketCore.ts.
/// 「貸す」 is deliberately absent (spec §4.4: v1 見送り).
enum ListingType { give, sell, want }

extension ListingTypeX on ListingType {
  String get value => switch (this) {
        ListingType.give => 'give',
        ListingType.sell => 'sell',
        ListingType.want => 'want',
      };

  String get label => switch (this) {
        ListingType.give => '譲ります',
        ListingType.sell => '売ります',
        ListingType.want => '買いたい',
      };

  static ListingType? fromValue(Object? v) {
    for (final t in ListingType.values) {
      if (t.value == v) return t;
    }
    return null;
  }
}

/// Wire values must equal `BOOK_CONDITIONS` in functions/src/marketCore.ts.
enum BookCondition { likeNew, good, fair, marked }

extension BookConditionX on BookCondition {
  String get value => switch (this) {
        BookCondition.likeNew => 'like_new',
        BookCondition.good => 'good',
        BookCondition.fair => 'fair',
        BookCondition.marked => 'marked',
      };

  String get label => switch (this) {
        BookCondition.likeNew => '新品同様',
        BookCondition.good => '目立った傷なし',
        BookCondition.fair => '使用感あり',
        BookCondition.marked => '書き込み多め',
      };

  static BookCondition? fromValue(Object? v) {
    for (final c in BookCondition.values) {
      if (c.value == v) return c;
    }
    return null;
  }
}

/// Handoff-place presets; keys must equal `HANDOFF_PLACES` in marketCore.ts.
const Map<String, String> kHandoffPlaces = {
  'clock_tower': '時計台前',
  'coop_central': '中央食堂・生協前',
  'library': '附属図書館前',
  'yoshida_south': '吉田南構内',
  'north_campus': '北部構内',
  'katsura': '桂キャンパス',
  'uji': '宇治キャンパス',
  'other': 'チャットで相談',
};

DateTime _time(dynamic v) {
  if (v is Timestamp) return v.toDate();
  if (v is String) return DateTime.tryParse(v) ?? DateTime.fromMillisecondsSinceEpoch(0);
  return DateTime.fromMillisecondsSinceEpoch(0);
}

int? _int(dynamic v) => v is int ? v : (v is num && v == v.roundToDouble() ? v.toInt() : null);
String _str(dynamic v) => v is String ? v : '';

/// One `textbook_listings/{id}` document (Plan 3). Written ONLY by the
/// createListing / updateListing Functions; the reader is total.
class TextbookListing {
  const TextbookListing({
    required this.id,
    required this.type,
    required this.title,
    this.description = '',
    this.courseId = '',
    this.courseName = '',
    this.condition,
    this.price,
    this.listPrice,
    this.place = 'other',
    this.photoPaths = const [],
    required this.ownerId,
    required this.ownerName,
    this.status = 'active',
    required this.createdAt,
    required this.expiresAt,
    this.renewCount = 0,
  });

  static const Duration lifetime = Duration(days: 30);
  static const Duration renewWindow = Duration(days: 7);

  final String id;
  final ListingType type;
  final String title;
  final String description;
  final String courseId;
  final String courseName;
  final BookCondition? condition;
  final int? price; // yen; information only — the app never handles money
  final int? listPrice; // 定価 (recommended upper bound for 売る)
  final String place;
  final List<String> photoPaths;
  final String ownerId;
  final String ownerName;
  final String status; // active | closed | hidden
  final DateTime createdAt;
  final DateTime expiresAt;
  final int renewCount;

  bool isLive(DateTime now) => status == 'active' && expiresAt.isAfter(now);

  /// 「まだ有効?」: an active listing in its last [renewWindow] (or expired) may be renewed.
  bool canRenew(DateTime now) => status == 'active' && !expiresAt.subtract(renewWindow).isAfter(now);

  String get placeLabel => kHandoffPlaces[place] ?? 'チャットで相談';

  /// A 売る price above the 定価 the seller entered (shown as a warning, never enforced, T-3).
  bool get priceAboveList => type == ListingType.sell && price != null && listPrice != null && price! > listPrice!;

  String get priceLabel => switch (type) {
        ListingType.give => '無料',
        ListingType.sell => price == null ? '価格未設定' : '¥$price',
        ListingType.want => price == null ? '予算未設定' : '予算 ¥$price',
      };

  factory TextbookListing.fromMap(String id, Map<String, dynamic> map) => TextbookListing(
        id: id,
        type: ListingTypeX.fromValue(map['type']) ?? ListingType.want,
        title: _str(map['title']),
        description: _str(map['description']),
        courseId: _str(map['courseId']),
        courseName: _str(map['courseName']),
        condition: BookConditionX.fromValue(map['condition']),
        price: _int(map['price']),
        listPrice: _int(map['listPrice']),
        place: kHandoffPlaces.containsKey(map['place']) ? map['place'] as String : 'other',
        photoPaths: map['photoPaths'] is List ? (map['photoPaths'] as List).whereType<String>().toList() : const [],
        ownerId: _str(map['ownerId']),
        ownerName: _str(map['ownerName']).isEmpty ? '京大生' : _str(map['ownerName']),
        status: _str(map['status']).isEmpty ? 'closed' : _str(map['status']),
        createdAt: _time(map['createdAt']),
        expiresAt: _time(map['expiresAt']),
        renewCount: _int(map['renewCount']) ?? 0,
      );
}

class RatingComment {
  const RatingComment({required this.stars, required this.comment});
  final int stars;
  final String comment;
}

/// `market_profiles/{uid}`: the KU-readable rating summary (Function-written, T-10).
class MarketProfile {
  const MarketProfile({this.ratingCount = 0, this.ratingSum = 0, this.recentComments = const []});

  final int ratingCount;
  final int ratingSum;
  final List<RatingComment> recentComments;

  double? get average => ratingCount == 0 ? null : ratingSum / ratingCount;

  String get summary => ratingCount == 0 ? '評価はまだありません' : '★${average!.toStringAsFixed(1)}（$ratingCount件）';

  factory MarketProfile.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const MarketProfile();
    final raw = map['recentComments'];
    return MarketProfile(
      ratingCount: _int(map['ratingCount']) ?? 0,
      ratingSum: _int(map['ratingSum']) ?? 0,
      recentComments: raw is List
          ? raw
              .whereType<Map>()
              .map((m) => RatingComment(stars: _int(m['stars']) ?? 0, comment: _str(m['comment'])))
              .where((c) => c.stars >= 1 && c.stars <= 5)
              .toList()
          : const [],
    );
  }
}
