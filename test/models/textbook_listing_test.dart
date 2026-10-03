import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/textbook_listing.dart';

void main() {
  final now = DateTime.utc(2027, 4, 10, 3);

  test('wire values match functions/src/marketCore.ts (LISTING_TYPES, BOOK_CONDITIONS, HANDOFF_PLACES)', () {
    expect(ListingType.values.map((t) => t.value), ['give', 'sell', 'want']);
    expect(BookCondition.values.map((c) => c.value), ['like_new', 'good', 'fair', 'marked']);
    expect(kHandoffPlaces.keys, ['clock_tower', 'coop_central', 'library', 'yoshida_south', 'north_campus', 'katsura', 'uji', 'other']);
  });

  test('parses a Function-written listing', () {
    final l = TextbookListing.fromMap('l1', {
      'type': 'sell', 'title': '線形代数入門', 'description': 'd', 'courseId': 'c1', 'courseName': '線形代数A',
      'condition': 'good', 'price': 1500, 'listPrice': 3000, 'place': 'library', 'photoPaths': ['listings/u1/a.jpg', 7],
      'ownerId': 'u1', 'ownerName': '山田', 'status': 'active', 'renewCount': 1,
      'createdAt': Timestamp.fromDate(now), 'expiresAt': Timestamp.fromDate(now.add(const Duration(days: 30))),
    });
    expect([l.type, l.condition, l.price, l.listPrice, l.placeLabel, l.photoPaths, l.priceLabel],
        [ListingType.sell, BookCondition.good, 1500, 3000, '附属図書館前', ['listings/u1/a.jpg'], '¥1500']);
    expect(l.isLive(now), isTrue);
    expect(l.priceAboveList, isFalse);
  });

  test('is total: garbage degrades (unknown type -> want, unknown place -> other, missing status -> closed)', () {
    final l = TextbookListing.fromMap('x', {'type': 'lend', 'price': '100', 'place': 'my_room', 'photoPaths': 'x', 'createdAt': 5});
    expect([l.type, l.price, l.place, l.photoPaths, l.status, l.ownerName], [ListingType.want, null, 'other', <String>[], 'closed', '京大生']);
    expect(l.isLive(now), isFalse);
  });

  test('isLive needs active AND unexpired; canRenew opens 7 days before expiry (boundary included)', () {
    TextbookListing at(Duration left, {String status = 'active'}) => TextbookListing(
          id: 'l', type: ListingType.give, title: 't', ownerId: 'u', ownerName: 'n', status: status,
          createdAt: now, expiresAt: now.add(left),
        );
    expect(at(const Duration(seconds: 1)).isLive(now), isTrue);
    expect(at(Duration.zero).isLive(now), isFalse);
    expect(at(const Duration(days: 1), status: 'hidden').isLive(now), isFalse);
    expect(at(const Duration(days: 7)).canRenew(now), isTrue);
    expect(at(const Duration(days: 7, seconds: 1)).canRenew(now), isFalse);
    expect(at(const Duration(days: -40)).canRenew(now), isTrue);
    expect(at(const Duration(days: 1), status: 'closed').canRenew(now), isFalse);
  });

  test('price labels and the above-list-price warning (informational only)', () {
    TextbookListing l(ListingType t, {int? price, int? list}) => TextbookListing(
          id: 'l', type: t, title: 't', ownerId: 'u', ownerName: 'n', price: price, listPrice: list, createdAt: now, expiresAt: now,
        );
    expect(l(ListingType.give).priceLabel, '無料');
    expect(l(ListingType.want, price: 800).priceLabel, '予算 ¥800');
    expect(l(ListingType.want).priceLabel, '予算未設定');
    expect(l(ListingType.sell, price: 3500, list: 3000).priceAboveList, isTrue);
    expect(l(ListingType.sell, price: 3000, list: 3000).priceAboveList, isFalse);
  });

  test('MarketProfile: average, summary, and only well-formed comments', () {
    expect(MarketProfile.fromMap(null).summary, '評価はまだありません');
    final p = MarketProfile.fromMap({'ratingCount': 2, 'ratingSum': 9, 'recentComments': [
      {'stars': 5, 'comment': '丁寧'}, {'stars': 9, 'comment': 'bad'}, 'junk',
    ]});
    expect(p.average, 4.5);
    expect(p.summary, '★4.5（2件）');
    expect(p.recentComments.map((c) => c.comment), ['丁寧']);
  });
}
