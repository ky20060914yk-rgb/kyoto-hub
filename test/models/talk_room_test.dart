import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/talk_room.dart';

void main() {
  TalkRoom room({DateTime? last, String lastSender = 'u2', DateTime? lenderRead, DateTime? borrowerRead}) => TalkRoom(
        id: 'r', listingId: 'l', bookTitle: 'b', subjectName: 's', lenderId: 'u1', lenderName: 'オーナー',
        borrowerId: 'u2', borrowerName: '買う人', createdAt: DateTime.utc(2027, 4, 1), lastMessageAt: last,
        lastSenderId: lastSender, lenderReadAt: lenderRead, borrowerReadAt: borrowerRead,
      );

  test('a Function-written room parses, including Timestamps and the summary', () {
    final r = TalkRoom.fromMap({
      'id': 'l_x_u2', 'listingId': 'x', 'bookTitle': '本', 'lenderId': 'u1', 'lenderName': 'A', 'borrowerId': 'u2', 'borrowerName': 'B',
      'createdAt': '2027-04-10T03:00:00.000Z', 'lastMessageText': 'hi', 'lastMessageAt': Timestamp.fromDate(DateTime.utc(2027, 4, 11)),
      'lastSenderId': 'u2', 'lenderSent': true, 'borrowerSent': true, 'closedBy': null,
    });
    expect([r.isLegacy, r.bothSpoke, r.isClosed, r.lastMessageText], [false, true, false, 'hi']);
    expect(r.lastActivity.toUtc(), DateTime.utc(2027, 4, 11));
  });

  test('a legacy 参考書 room (messages array, no listing) still parses and is not ratable', () {
    final r = TalkRoom.fromMap({
      'id': 'room_1', 'requestId': 'tb_1', 'lenderId': 'u1', 'borrowerId': 'u2', 'createdAt': '2026-09-01T10:00:00.000',
      'messages': [{'text': 'old'}], 'warningNotice': '',
    });
    expect([r.isLegacy, r.bothSpoke, r.lastMessageAt], [true, false, null]);
    expect(r.warningNotice, TalkRoom.kRoomWarning);
    expect(r.lastActivity, DateTime(2026, 9, 1, 10));
  });

  test('is total: garbage degrades instead of throwing', () {
    final r = TalkRoom.fromMap({'id': 7, 'createdAt': {'x': 1}, 'lastMessageAt': 'nope', 'closedBy': 5, 'lenderSent': 'yes'});
    expect([r.id, r.lastMessageAt, r.closedBy, r.lenderSent], ['', null, null, false]);
  });

  test('isUnreadFor: only a newer message from the OTHER party, only for a party', () {
    final t = DateTime.utc(2027, 4, 10, 12);
    expect(room(last: t).isUnreadFor('u1'), isTrue); // never read
    expect(room(last: t, lenderRead: t.subtract(const Duration(seconds: 1))).isUnreadFor('u1'), isTrue);
    expect(room(last: t, lenderRead: t).isUnreadFor('u1'), isFalse); // read exactly then
    expect(room(last: t).isUnreadFor('u2'), isFalse); // my own last message
    expect(room().isUnreadFor('u1'), isFalse); // no message yet
    expect(room(last: t).isUnreadFor('stranger'), isFalse);
    expect(room(last: t).isUnreadFor(null), isFalse);
  });

  test('names come from the room, never from a message', () {
    final r = room();
    expect([r.nameOf('u1'), r.nameOf('u2'), r.nameOf('x')], ['オーナー', '買う人', '京大生']);
    expect([r.otherName('u1'), r.otherName('u2')], ['買う人', 'オーナー']);
  });

  test('ChatMessage: a pending server timestamp is flagged, garbage degrades', () {
    final m = ChatMessage.fromMap('m', {'senderId': 'u1', 'text': 'hi', 'createdAt': null});
    expect(m.pending, isTrue);
    final ok = ChatMessage.fromMap('m', {'senderId': 'u1', 'text': 'hi', 'createdAt': Timestamp.fromDate(DateTime.utc(2027))});
    expect([ok.pending, ok.createdAt.toUtc()], [false, DateTime.utc(2027)]);
    expect(ChatMessage.fromMap('m', {'text': 3}).text, '');
  });
}
