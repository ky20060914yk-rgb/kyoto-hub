import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/textbook_listing.dart';
import 'package:kyoto_exam_hub/services/market_service.dart';

Map<String, dynamic> _listing(String owner, {String status = 'active', int days = 10, String type = 'sell', String courseId = '', String title = '線形代数入門'}) => {
      'type': type, 'title': title, 'ownerId': owner, 'ownerName': 'n', 'status': status, 'courseId': courseId,
      'courseName': courseId.isEmpty ? '' : '線形代数A', 'condition': 'good', 'price': 1000, 'place': 'clock_tower',
      'createdAt': Timestamp.fromDate(DateTime.utc(2027, 4, 1)),
      'expiresAt': Timestamp.fromDate(DateTime.utc(2027, 4, 10).add(Duration(days: days))),
    };

void main() {
  final now = DateTime.utc(2027, 4, 10);

  test('wire values match functions/src/marketModeration.ts', () {
    expect(ListingReportCategory.values.map((c) => c.value), ['not_textbook', 'spam', 'inappropriate', 'other']);
    expect(RoomReportCategory.values.map((c) => c.value), ['harassment', 'no_show', 'fraud', 'other']);
  });

  test('streamListings shows only live listings (active AND unexpired), optionally one course', () async {
    final db = FakeFirebaseFirestore();
    await db.collection('textbook_listings').doc('live').set(_listing('u1'));
    await db.collection('textbook_listings').doc('course').set(_listing('u2', courseId: 'c1'));
    await db.collection('textbook_listings').doc('expired').set(_listing('u1', days: -1));
    await db.collection('textbook_listings').doc('closed').set(_listing('u1', status: 'closed'));
    await db.collection('textbook_listings').doc('hidden').set(_listing('u1', status: 'hidden'));
    final svc = MarketService(db, (_, _) async => {});
    expect((await svc.streamListings(now: now).first).map((l) => l.id).toSet(), {'live', 'course'});
    expect((await svc.streamListings(courseId: 'c1', now: now).first).map((l) => l.id), ['course']);
    expect((await svc.streamMyListings('u1').first).map((l) => l.id).toSet(), {'live', 'expired', 'closed', 'hidden'});
  });

  test('createListing sends the whitelisted payload; 譲る never sends a price', () async {
    final sent = <(String, Map<String, dynamic>)>[];
    final svc = MarketService(FakeFirebaseFirestore(), (name, data) async {
      sent.add((name, data));
      return {'listingId': 'L1'};
    });
    expect(await svc.createListing(const ListingDraft(
      type: ListingType.give, title: '  微積分  ', condition: BookCondition.fair, price: 500, place: 'library',
    )), 'L1');
    expect(sent.single.$1, 'createListing');
    expect(sent.single.$2, {
      'type': 'give', 'title': '微積分', 'description': '', 'courseId': '', 'condition': 'fair', 'price': null,
      'listPrice': null, 'place': 'library', 'photoPaths': <String>[],
    });
  });

  test('the update / chat / block / rate / report callables carry exactly their arguments', () async {
    final sent = <(String, Map<String, dynamic>)>[];
    var reply = <String, dynamic>{};
    final svc = MarketService(FakeFirebaseFirestore(), (name, data) async {
      sent.add((name, data));
      return reply;
    });
    await svc.renewListing('L1');
    await svc.closeListing('L1');
    reply = {'roomId': 'l_L1_u2'};
    expect(await svc.openChat('L1'), 'l_L1_u2');
    await svc.blockRoom('R1');
    reply = {'status': 'rated', 'revealed': false};
    expect(await svc.rateDeal('R1', 4, ' よかった '), isTrue);
    reply = {'status': 'case_opened'};
    expect(await svc.reportRoom('R1', RoomReportCategory.noShow, ' 来なかった '), MarketReportOutcome.caseOpened);
    reply = {'status': 'hidden'};
    expect(await svc.reportListing('L1', ListingReportCategory.notTextbook, ''), MarketReportOutcome.hidden);
    expect(sent.map((s) => s.$1), ['updateListing', 'updateListing', 'openListingChat', 'blockRoom', 'rateDeal', 'reportMarket', 'reportMarket']);
    expect(sent[0].$2, {'listingId': 'L1', 'action': 'renew'});
    expect(sent[1].$2, {'listingId': 'L1', 'action': 'close'});
    expect(sent[4].$2, {'roomId': 'R1', 'stars': 4, 'comment': 'よかった'});
    expect(sent[5].$2, {'kind': 'room', 'targetId': 'R1', 'category': 'no_show', 'detail': '来なかった'});
  });

  test('validateListingDraft mirrors the server rules', () {
    const ok = ListingDraft(type: ListingType.sell, title: '本', condition: BookCondition.good, price: 1);
    expect(validateListingDraft(ok), isNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.sell, title: ' ', condition: BookCondition.good, price: 1)), isNotNull);
    expect(validateListingDraft(ListingDraft(type: ListingType.sell, title: 'x' * 101, condition: BookCondition.good, price: 1)), isNotNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.sell, title: '本', condition: BookCondition.good)), isNotNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.sell, title: '本', condition: BookCondition.good, price: 100001)), isNotNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.give, title: '本')), isNotNull); // condition required
    expect(validateListingDraft(const ListingDraft(type: ListingType.want, title: '本')), isNull);
    expect(validateListingDraft(const ListingDraft(type: ListingType.want, title: '本', place: 'my_room')), isNotNull);
  });

  test('containsContactInfo flags phone numbers, e-mail addresses and LINE IDs', () {
    expect(containsContactInfo('090-1234-5678 に電話'), isTrue);
    expect(containsContactInfo('連絡は a@b.jp まで'), isTrue);
    expect(containsContactInfo('LINE ID: kyodai'), isTrue);
    expect(containsContactInfo('時計台前で12時に'), isFalse);
  });

  test('filterListings: type + every word in title/course/description, case and space insensitive', () {
    TextbookListing l(String id, ListingType t, String title, {String course = ''}) => TextbookListing(
          id: id, type: t, title: title, courseName: course, ownerId: 'u', ownerName: 'n', createdAt: now, expiresAt: now,
        );
    final all = [l('a', ListingType.sell, 'Campbell Biology'), l('b', ListingType.give, '線形代数入門', course: '線形代数A'),
      l('c', ListingType.want, '微分積分')];
    expect(filterListings(all, query: 'campbell').map((x) => x.id), ['a']);
    expect(filterListings(all, query: '線形 代数A').map((x) => x.id), ['b']);
    expect(filterListings(all, type: ListingType.want).map((x) => x.id), ['c']);
    expect(filterListings(all).length, 3);
  });

  test('photo paths and types: own listings/ prefix, images only', () {
    expect(MarketService.photoPath('u1', 'my book.JPG', 7), 'listings/u1/7_my_book.JPG');
    expect(MarketService.photoContentType('a.JPG'), 'image/jpeg');
    expect(MarketService.photoContentType('a.webp'), 'image/webp');
    expect(MarketService.photoContentType('a.pdf'), isNull);
    expect(MarketService.photoContentType('a.svg'), isNull);
  });

  test('listingShareText names the book and the app, never the owner', () {
    final l = TextbookListing(id: 'l', type: ListingType.give, title: '線形代数入門', courseName: '線形代数A', ownerId: 'u', ownerName: '山田',
        createdAt: now, expiresAt: now);
    final t = listingShareText(l);
    expect(t, contains('譲ります: 『線形代数入門』（線形代数A） 無料'));
    expect(t, contains('https://kyodai-info.web.app/'));
    expect(t, isNot(contains('山田')));
  });

  test('MarketException.notice covers the server codes the UI shows', () {
    expect(MarketException('resource-exhausted', 'listing-limit').notice, contains('上限'));
    expect(MarketException('failed-precondition', 'blocked').notice, contains('やりとりできません'));
    expect(MarketException('failed-precondition', 'listing-closed').notice, contains('受付を終了'));
    expect(MarketException('failed-precondition', 'no-exchange').notice, contains('双方'));
    expect(MarketException('failed-precondition', 'too-early').notice, contains('7日前'));
  });
}
