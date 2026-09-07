class ChatMessage {
  final String id;
  final String senderId;
  final String senderName;
  final String text;
  final DateTime createdAt;

  ChatMessage({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.text,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'senderId': senderId,
      'senderName': senderName,
      'text': text,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory ChatMessage.fromMap(Map<String, dynamic> map) {
    return ChatMessage(
      id: map['id'] ?? '',
      senderId: map['senderId'] ?? '',
      senderName: map['senderName'] ?? '',
      text: map['text'] ?? '',
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
    );
  }
}

class TalkRoom {
  final String id;
  final String universityId; // 'kyoto_u'
  final String requestId;
  final String bookTitle;
  final String subjectName;
  final String borrowerId;
  final String borrowerName;
  final String lenderId;
  final String lenderName;
  final List<ChatMessage> messages;
  final DateTime createdAt;
  final String warningNotice;

  TalkRoom({
    required this.id,
    this.universityId = 'kyoto_u',
    required this.requestId,
    required this.bookTitle,
    required this.subjectName,
    required this.borrowerId,
    required this.borrowerName,
    required this.lenderId,
    required this.lenderName,
    required this.messages,
    required this.createdAt,
    this.warningNotice = '取引が完了しなかった場合、アカウント停止の可能性があります',
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'university_id': universityId,
      'requestId': requestId,
      'bookTitle': bookTitle,
      'subjectName': subjectName,
      'borrowerId': borrowerId,
      'borrowerName': borrowerName,
      'lenderId': lenderId,
      'lenderName': lenderName,
      'messages': messages.map((m) => m.toMap()).toList(),
      'createdAt': createdAt.toIso8601String(),
      'warningNotice': warningNotice,
    };
  }

  factory TalkRoom.fromMap(Map<String, dynamic> map) {
    return TalkRoom(
      id: map['id'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      requestId: map['requestId'] ?? '',
      bookTitle: map['bookTitle'] ?? '',
      subjectName: map['subjectName'] ?? '',
      borrowerId: map['borrowerId'] ?? '',
      borrowerName: map['borrowerName'] ?? '',
      lenderId: map['lenderId'] ?? '',
      lenderName: map['lenderName'] ?? '',
      messages: (map['messages'] as List<dynamic>?)
              ?.map((m) => ChatMessage.fromMap(m as Map<String, dynamic>))
              .toList() ??
          [],
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
      warningNotice: map['warningNotice'] ?? '取引が完了しなかった場合、アカウント停止の可能性があります',
    );
  }
}
