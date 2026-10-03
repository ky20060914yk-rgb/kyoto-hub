import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/talk_room.dart';

/// Plan 2B (M-15): `talk_rooms` are readable only by their two participants, so
/// the client listens to the rooms it lends in and the rooms it borrows in — two
/// single-field equality queries the rules can prove — and merges them, newest
/// first. (A university-wide stream is now refused by the rules.)
Stream<List<TalkRoom>> participantTalkRooms(FirebaseFirestore db, String uid) {
  final rooms = db.collection('talk_rooms');
  var lent = const <TalkRoom>[];
  var borrowed = const <TalkRoom>[];
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? a;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? b;
  late final StreamController<List<TalkRoom>> out;

  List<TalkRoom> parse(QuerySnapshot<Map<String, dynamic>> s) =>
      s.docs.map((d) => TalkRoom.fromMap(d.data())).toList();

  void emit() {
    final byId = <String, TalkRoom>{for (final r in [...lent, ...borrowed]) r.id: r};
    out.add(byId.values.toList()..sort((x, y) => y.createdAt.compareTo(x.createdAt)));
  }

  out = StreamController<List<TalkRoom>>(
    onListen: () {
      a = rooms.where('lenderId', isEqualTo: uid).snapshots().listen((s) {
        lent = parse(s);
        emit();
      }, onError: out.addError);
      b = rooms.where('borrowerId', isEqualTo: uid).snapshots().listen((s) {
        borrowed = parse(s);
        emit();
      }, onError: out.addError);
    },
    onCancel: () async {
      await a?.cancel();
      await b?.cancel();
    },
  );
  return out.stream;
}
