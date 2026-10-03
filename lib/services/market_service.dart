import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/textbook_listing.dart';
import '../repositories/post_repository.dart';
import 'credit_service.dart' show CallableInvoker;

/// Limits mirrored from functions/src/marketCore.ts `MARKET`; the server re-checks.
const int kListingMaxTitle = 100;
const int kListingMaxDescription = 1000;
const int kListingMaxPhotos = 3;
const int kListingMaxPrice = 100000;
const int kListingPhotoMaxBytes = 2 * 1024 * 1024;
const int kChatMaxMessage = 1000;
const int kRatingMaxComment = 60;

/// Wire values must equal `LISTING_REPORT_CATEGORIES` in marketModeration.ts.
enum ListingReportCategory { notTextbook, spam, inappropriate, other }

extension ListingReportCategoryX on ListingReportCategory {
  String get value => switch (this) {
        ListingReportCategory.notTextbook => 'not_textbook',
        ListingReportCategory.spam => 'spam',
        ListingReportCategory.inappropriate => 'inappropriate',
        ListingReportCategory.other => 'other',
      };

  String get label => switch (this) {
        ListingReportCategory.notTextbook => '教科書・参考書ではない',
        ListingReportCategory.spam => 'スパム・重複出品',
        ListingReportCategory.inappropriate => '不適切な内容',
        ListingReportCategory.other => 'その他',
      };
}

/// Wire values must equal `ROOM_REPORT_CATEGORIES` in marketModeration.ts.
enum RoomReportCategory { harassment, noShow, fraud, other }

extension RoomReportCategoryX on RoomReportCategory {
  String get value => switch (this) {
        RoomReportCategory.harassment => 'harassment',
        RoomReportCategory.noShow => 'no_show',
        RoomReportCategory.fraud => 'fraud',
        RoomReportCategory.other => 'other',
      };

  String get label => switch (this) {
        RoomReportCategory.harassment => '嫌がらせ・迷惑行為',
        RoomReportCategory.noShow => '受け渡し不履行（来なかった・連絡が途絶えた）',
        RoomReportCategory.fraud => '詐欺・金銭トラブル',
        RoomReportCategory.other => 'その他',
      };
}

enum MarketReportOutcome { reported, hidden, duplicate, alreadyHidden, caseOpened }

class MarketException implements Exception {
  MarketException(this.code, this.message);
  final String code;
  final String message;

  bool get isLimit => code == 'resource-exhausted';
  bool get isBlocked => message.contains('blocked');
  bool get isListingClosed => message.contains('listing-closed');
  bool get isNotFound => code == 'not-found';

  /// The notice to show for this error.
  String get notice {
    if (isLimit) return '本日の上限に達しました。明日以降にもう一度お試しください。';
    if (isBlocked) return 'この相手とはやりとりできません。';
    if (isListingClosed) return 'この出品は受付を終了しています。';
    if (isNotFound) return '見つかりませんでした。削除された可能性があります。';
    if (message.contains('no-exchange')) return '双方がメッセージを送った取引だけ評価できます。';
    if (message.contains('too-early')) return '掲載期限の7日前から延長できます。';
    if (message.contains('rating-closed')) return '相手の評価がすでに公開されたため、この取引は評価できません。';
    if (message.contains('own-listing')) return '自分の出品にはトークを開始したり報告したりできません。';
    if (message.contains('legacy-room')) return '以前のしくみのトークルームのため、評価できません。';
    if (message.contains('self')) return '自分自身を評価することはできません。';
    if (message.contains('not-active')) return 'この出品は受付中ではないため、変更できません。';
    if (message.contains('expired')) return 'この出品は掲載期限が切れています。';
    return '処理に失敗しました。メール認証の状態と通信環境を確認してください。';
  }

  @override
  String toString() => 'MarketException($code, $message)';
}

/// What a seller/buyer fills in. Title, type, course and photos are fixed after
/// creation (the server ignores them on edit).
class ListingDraft {
  const ListingDraft({
    required this.type,
    required this.title,
    this.description = '',
    this.courseId = '',
    this.condition,
    this.price,
    this.listPrice,
    this.place = 'clock_tower',
    this.photoPaths = const [],
  });

  final ListingType type;
  final String title;
  final String description;
  final String courseId;
  final BookCondition? condition;
  final int? price;
  final int? listPrice;
  final String place;
  final List<String> photoPaths;

  Map<String, dynamic> toPayload() => {
        'type': type.value,
        'title': title.trim(),
        'description': description.trim(),
        'courseId': courseId,
        'condition': condition?.value ?? '',
        'price': type == ListingType.give ? null : price,
        'listPrice': listPrice,
        'place': place,
        'photoPaths': photoPaths,
      };
}

/// Null when [d] is acceptable, otherwise the message to show (mirrors parseListingDraft).
String? validateListingDraft(ListingDraft d) {
  final title = d.title.trim();
  if (title.isEmpty || title.length > kListingMaxTitle) return '本のタイトルを入力してください（100文字まで）';
  if (d.description.trim().length > kListingMaxDescription) return '説明は1000文字までです';
  if (d.type != ListingType.want && d.condition == null) return '本の状態を選んでください';
  if (d.type == ListingType.sell && (d.price == null || d.price! < 1 || d.price! > kListingMaxPrice)) {
    return '価格を1〜100000円で入力してください';
  }
  if (d.type == ListingType.want && d.price != null && (d.price! < 0 || d.price! > kListingMaxPrice)) {
    return '予算は0〜100000円で入力してください';
  }
  if (d.listPrice != null && (d.listPrice! < 0 || d.listPrice! > kListingMaxPrice)) return '定価は0〜100000円で入力してください';
  if (!kHandoffPlaces.containsKey(d.place)) return '受け渡し場所を選んでください';
  if (d.photoPaths.length > kListingMaxPhotos) return '写真は3枚までです';
  return null;
}

final RegExp _phone = RegExp(r'0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}');
final RegExp _email = RegExp(r'[^@\s]+@[^@\s]+\.[^@\s]+');
final RegExp _lineId = RegExp(r'(line|ライン|LINE)\s*(id|ID|ＩＤ)?\s*[:：]', caseSensitive: false);

/// True when [text] looks like it carries a phone number, an e-mail address or
/// a LINE ID — the form and chat show a warning (T-15); nothing is blocked.
bool containsContactInfo(String text) =>
    _phone.hasMatch(text) || _email.hasMatch(text) || _lineId.hasMatch(text);

String _fold(String s) => s.toLowerCase().replaceAll(RegExp(r'\s+'), '');

/// Client-side search over the live list (T-7): type filter + free words, every
/// word must appear in the title, the course name or the description.
List<TextbookListing> filterListings(List<TextbookListing> all, {ListingType? type, String query = ''}) {
  final words = query.split(RegExp(r'\s+')).map(_fold).where((w) => w.isNotEmpty).toList();
  return all.where((l) {
    if (type != null && l.type != type) return false;
    final hay = _fold('${l.title} ${l.courseName} ${l.description}');
    return words.every(hay.contains);
  }).toList();
}

/// The text the 「シェア」 button copies (T-22): no deep link (the app has no
/// routes), no owner name, no price for 譲る/買いたい beyond the label.
String listingShareText(TextbookListing l) {
  final course = l.courseName.isEmpty ? '' : '（${l.courseName}）';
  return '【京大InfoHub 教科書】${l.type.label}: 『${l.title}』$course ${l.priceLabel}\n'
      '京大生ならアプリの「教科書」タブで見られます → https://kyodai-info.web.app/';
}

/// Plan 3 market client: listings (read), the six market callables, rating
/// summaries. The client never writes a listing, room, rating or report.
class MarketService {
  MarketService(this._db, this._call);

  factory MarketService.live(FirebaseFirestore db) => MarketService(db, _liveInvoker);

  final FirebaseFirestore _db;
  final CallableInvoker _call;

  static Future<Map<String, dynamic>> _liveInvoker(String name, Map<String, dynamic> data) async {
    try {
      final res = await FirebaseFunctions.instanceFor(region: 'asia-east1')
          .httpsCallable(name)
          .call<Map<Object?, Object?>>(data);
      return Map<String, dynamic>.from(res.data);
    } on FirebaseFunctionsException catch (e) {
      throw MarketException(e.code, e.message ?? e.code);
    }
  }

  /// `listings/<uid>/<millis>_<safe name>` — the only shape storage.rules accept.
  static String photoPath(String uid, String fileName, int millis) =>
      'listings/$uid/${millis}_${PostRepository.safeFileName(fileName).replaceAll(RegExp(r'\.{2,}'), '.')}';

  /// The content type of an accepted photo, or null (pdf, gif, svg, … are refused).
  static String? photoContentType(String fileName) {
    final lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return null;
  }

  CollectionReference<Map<String, dynamic>> get _listings => _db.collection('textbook_listings');

  List<TextbookListing> _parse(QuerySnapshot<Map<String, dynamic>> q) =>
      q.docs.map((d) => TextbookListing.fromMap(d.id, d.data())).toList();

  /// Live (active, unexpired) listings, newest expiry first; optionally one
  /// course. Needs the (status, expiresAt) / (courseId, status, expiresAt) indexes.
  Stream<List<TextbookListing>> streamListings({String courseId = '', DateTime? now, int limit = 100}) {
    final at = now ?? DateTime.now();
    Query<Map<String, dynamic>> q = _listings;
    if (courseId.isNotEmpty) q = q.where('courseId', isEqualTo: courseId);
    return q
        .where('status', isEqualTo: 'active')
        .where('expiresAt', isGreaterThan: Timestamp.fromDate(at))
        .orderBy('expiresAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((s) => _parse(s).where((l) => l.isLive(at)).toList());
  }

  /// Every listing of [uid] (any status), newest first.
  Stream<List<TextbookListing>> streamMyListings(String uid) => _listings
      .where('ownerId', isEqualTo: uid)
      .snapshots()
      .map((s) => _parse(s)..sort((a, b) => b.createdAt.compareTo(a.createdAt)));

  Future<TextbookListing?> getListing(String id) async {
    final d = await _listings.doc(id).get();
    return d.exists ? TextbookListing.fromMap(d.id, d.data()!) : null;
  }

  Stream<MarketProfile> streamProfile(String uid) =>
      _db.collection('market_profiles').doc(uid).snapshots().map((s) => MarketProfile.fromMap(s.data()));

  Future<String> createListing(ListingDraft d) async {
    final r = await _call('createListing', d.toPayload());
    return r['listingId'] is String ? r['listingId'] as String : '';
  }

  Future<void> editListing(String listingId, ListingDraft d) =>
      _call('updateListing', {...d.toPayload(), 'listingId': listingId, 'action': 'edit'});

  Future<void> renewListing(String listingId) => _call('updateListing', {'listingId': listingId, 'action': 'renew'});

  Future<void> closeListing(String listingId) => _call('updateListing', {'listingId': listingId, 'action': 'close'});

  /// Opens (or re-opens) the chat about [listingId]; returns the room id.
  Future<String> openChat(String listingId) async {
    final r = await _call('openListingChat', {'listingId': listingId});
    return r['roomId'] is String ? r['roomId'] as String : '';
  }

  Future<void> blockRoom(String roomId) => _call('blockRoom', {'roomId': roomId});

  Future<MarketReportOutcome> reportListing(String listingId, ListingReportCategory c, String detail) =>
      _report('listing', listingId, c.value, detail);

  Future<MarketReportOutcome> reportRoom(String roomId, RoomReportCategory c, String detail) =>
      _report('room', roomId, c.value, detail);

  Future<MarketReportOutcome> _report(String kind, String id, String category, String detail) async {
    final r = await _call('reportMarket', {'kind': kind, 'targetId': id, 'category': category, 'detail': detail.trim()});
    return switch (r['status']) {
      'hidden' => MarketReportOutcome.hidden,
      'duplicate' => MarketReportOutcome.duplicate,
      'already_hidden' => MarketReportOutcome.alreadyHidden,
      'case_opened' => MarketReportOutcome.caseOpened,
      _ => MarketReportOutcome.reported,
    };
  }

  /// Returns whether the rating was accepted now (false: already rated).
  Future<bool> rateDeal(String roomId, int stars, String comment) async {
    final r = await _call('rateDeal', {'roomId': roomId, 'stars': stars, 'comment': comment.trim()});
    return r['status'] == 'rated';
  }
}
