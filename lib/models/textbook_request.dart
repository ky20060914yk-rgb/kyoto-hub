enum TextbookRequestStatus {
  open,     // 募集中
  matched,  // マッチング完了 (トークルーム作成済)
  completed,// 取引完了
}

class TextbookRequest {
  final String id;
  final String universityId; // 'kyoto_u'
  final String requesterId;
  final String requesterName;
  final String subjectId; // From user registered timetable courses
  final String subjectName;
  final String bookTitle; // Free text input
  final TextbookRequestStatus status;
  final String? responderId;
  final String? responderName;
  final String? talkRoomId;
  final DateTime createdAt;

  TextbookRequest({
    required this.id,
    this.universityId = 'kyoto_u',
    required this.requesterId,
    required this.requesterName,
    required this.subjectId,
    required this.subjectName,
    required this.bookTitle,
    this.status = TextbookRequestStatus.open,
    this.responderId,
    this.responderName,
    this.talkRoomId,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'university_id': universityId,
      'requesterId': requesterId,
      'requesterName': requesterName,
      'subjectId': subjectId,
      'subjectName': subjectName,
      'bookTitle': bookTitle,
      'status': status.name,
      'responderId': responderId,
      'responderName': responderName,
      'talkRoomId': talkRoomId,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory TextbookRequest.fromMap(Map<String, dynamic> map) {
    return TextbookRequest(
      id: map['id'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      requesterId: map['requesterId'] ?? '',
      requesterName: map['requesterName'] ?? '匿名京大生',
      subjectId: map['subjectId'] ?? '',
      subjectName: map['subjectName'] ?? '',
      bookTitle: map['bookTitle'] ?? '',
      status: TextbookRequestStatus.values.firstWhere(
        (e) => e.name == map['status'],
        orElse: () => TextbookRequestStatus.open,
      ),
      responderId: map['responderId'],
      responderName: map['responderName'],
      talkRoomId: map['talkRoomId'],
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
    );
  }

  TextbookRequest copyWith({
    TextbookRequestStatus? status,
    String? responderId,
    String? responderName,
    String? talkRoomId,
  }) {
    return TextbookRequest(
      id: id,
      universityId: universityId,
      requesterId: requesterId,
      requesterName: requesterName,
      subjectId: subjectId,
      subjectName: subjectName,
      bookTitle: bookTitle,
      status: status ?? this.status,
      responderId: responderId ?? this.responderId,
      responderName: responderName ?? this.responderName,
      talkRoomId: talkRoomId ?? this.talkRoomId,
      createdAt: createdAt,
    );
  }
}
