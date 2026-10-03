import 'package:cloud_firestore/cloud_firestore.dart';

DateTime? _time(dynamic v) {
  if (v is Timestamp) return v.toDate();
  if (v is String) return DateTime.tryParse(v);
  return null;
}

String _str(dynamic v) => v is String ? v : '';

/// One document of `talk_rooms/{roomId}/messages` (Plan 3, spec §4.5.5).
/// The sender's NAME is not stored: the screen takes it from the room, whose
/// names the Function sanitized (T-13). Total: garbage degrades, never throws.
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.senderId,
    required this.text,
    required this.createdAt,
    this.pending = false,
  });

  final String id;
  final String senderId;
  final String text;
  final DateTime createdAt;

  /// True while the server timestamp of a just-sent message is not back yet.
  final bool pending;

  factory ChatMessage.fromMap(String id, Map<String, dynamic> map) {
    final at = _time(map['createdAt']);
    return ChatMessage(
      id: id,
      senderId: _str(map['senderId']),
      text: _str(map['text']),
      createdAt: at ?? DateTime.now(),
      pending: at == null,
    );
  }
}

/// A two-party chat about one listing (Plan 3). Created only by the
/// `openListingChat` Function; `lenderId` = the listing owner, `borrowerId` =
/// the person who asked (historical names, kept so 2B's participant rules and
/// queries stay valid). The summary fields are written by `onTalkMessageCreated`;
/// a participant may only move their own read marker.
class TalkRoom {
  TalkRoom({
    required this.id,
    this.universityId = 'kyoto_u',
    this.listingId = '',
    this.listingType = '',
    this.requestId = '',
    required this.bookTitle,
    required this.subjectName,
    required this.borrowerId,
    required this.borrowerName,
    required this.lenderId,
    required this.lenderName,
    required this.createdAt,
    this.warningNotice = kRoomWarning,
    this.lastMessageText = '',
    this.lastMessageAt,
    this.lastSenderId = '',
    this.lenderSent = false,
    this.borrowerSent = false,
    this.lenderReadAt,
    this.borrowerReadAt,
    this.closedBy,
  });

  static const String kRoomWarning =
      'アプリはお金を扱いません。代金は受け渡しのときに当事者どうしで直接やりとりしてください。電話番号・住所などの個人情報は送らないでください。';

  final String id;
  final String universityId;
  final String listingId; // '' = a legacy 参考書 room (no rating, T-10)
  final String listingType;
  final String requestId;
  final String bookTitle;
  final String subjectName;
  final String borrowerId;
  final String borrowerName;
  final String lenderId;
  final String lenderName;
  final DateTime createdAt;
  final String warningNotice;
  final String lastMessageText;
  final DateTime? lastMessageAt;
  final String lastSenderId;
  final bool lenderSent;
  final bool borrowerSent;
  final DateTime? lenderReadAt;
  final DateTime? borrowerReadAt;
  final String? closedBy;

  bool get isLegacy => listingId.isEmpty;
  bool get isClosed => (closedBy ?? '').isNotEmpty;
  bool get bothSpoke => lenderSent && borrowerSent;
  DateTime get lastActivity => lastMessageAt ?? createdAt;
  bool isParty(String? uid) => uid != null && uid.isNotEmpty && (uid == lenderId || uid == borrowerId);

  /// The name shown for [senderId] (from the room, never from the message).
  String nameOf(String senderId) =>
      senderId == lenderId ? lenderName : senderId == borrowerId ? borrowerName : '京大生';
  String otherName(String uid) => uid == lenderId ? borrowerName : lenderName;

  /// A message from the other party is newer than my read marker.
  bool isUnreadFor(String? uid) {
    final at = lastMessageAt;
    if (!isParty(uid) || at == null || lastSenderId == uid) return false;
    final mine = uid == lenderId ? lenderReadAt : borrowerReadAt;
    return mine == null || mine.isBefore(at);
  }

  /// Test seeding / legacy shape only — the client never writes a room.
  Map<String, dynamic> toMap() => {
        'id': id,
        'university_id': universityId,
        'listingId': listingId,
        'listingType': listingType,
        'requestId': requestId,
        'bookTitle': bookTitle,
        'subjectName': subjectName,
        'borrowerId': borrowerId,
        'borrowerName': borrowerName,
        'lenderId': lenderId,
        'lenderName': lenderName,
        'createdAt': createdAt.toIso8601String(),
        'warningNotice': warningNotice,
        'lastMessageText': lastMessageText,
        'lastMessageAt': lastMessageAt == null ? null : Timestamp.fromDate(lastMessageAt!),
        'lastSenderId': lastSenderId,
        'lenderSent': lenderSent,
        'borrowerSent': borrowerSent,
        'lenderReadAt': lenderReadAt == null ? null : Timestamp.fromDate(lenderReadAt!),
        'borrowerReadAt': borrowerReadAt == null ? null : Timestamp.fromDate(borrowerReadAt!),
        'closedBy': closedBy,
      };

  factory TalkRoom.fromMap(Map<String, dynamic> map) => TalkRoom(
        id: _str(map['id']),
        universityId: map['university_id'] is String ? map['university_id'] as String : 'kyoto_u',
        listingId: _str(map['listingId']),
        listingType: _str(map['listingType']),
        requestId: _str(map['requestId']),
        bookTitle: _str(map['bookTitle']),
        subjectName: _str(map['subjectName']),
        borrowerId: _str(map['borrowerId']),
        borrowerName: _str(map['borrowerName']),
        lenderId: _str(map['lenderId']),
        lenderName: _str(map['lenderName']),
        createdAt: _time(map['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
        warningNotice: map['warningNotice'] is String && (map['warningNotice'] as String).isNotEmpty
            ? map['warningNotice'] as String
            : kRoomWarning,
        lastMessageText: _str(map['lastMessageText']),
        lastMessageAt: _time(map['lastMessageAt']),
        lastSenderId: _str(map['lastSenderId']),
        lenderSent: map['lenderSent'] == true,
        borrowerSent: map['borrowerSent'] == true,
        lenderReadAt: _time(map['lenderReadAt']),
        borrowerReadAt: _time(map['borrowerReadAt']),
        closedBy: map['closedBy'] is String ? map['closedBy'] as String : null,
      );
}
