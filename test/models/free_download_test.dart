import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/post.dart';
import 'package:kyoto_exam_hub/models/request.dart';

Post post({String author = 'a', String? requestId}) => Post(
      id: 'p1', subjectId: 'c', subjectName: 'n', authorId: author, authorName: 'x',
      category: PostCategory.pastExam, title: 't', description: '',
      filePaths: ['resources/a/1.pdf'], fileNames: ['1.pdf'], createdAt: DateTime.utc(2026, 10, 3),
      requestId: requestId,
    );

MaterialRequest req(String id, String author, {String? fulfilled}) => MaterialRequest(
      id: id, subjectId: 'c', subjectName: 'n', authorId: author, authorName: 'x',
      category: PostCategory.pastExam, title: 't', description: '', costSpent: 0, rewardPoints: 0,
      createdAt: DateTime.utc(2026, 10, 3), isFulfilled: fulfilled != null, fulfilledPostId: fulfilled,
    );

void main() {
  test('author is free; a stranger is not; signed-out is not', () {
    expect(isFreeDownload(post(), 'a', []), isTrue);
    expect(isFreeDownload(post(), 'z', []), isFalse);
    expect(isFreeDownload(post(), null, []), isFalse);
  });

  test('requester is free only when the post was created for that request', () {
    expect(isFreeDownload(post(requestId: 'r1'), 'q', [req('r1', 'q', fulfilled: 'p1')]), isTrue);
    // forged fulfilledPostId on an unrelated request
    expect(isFreeDownload(post(), 'q', [req('r9', 'q', fulfilled: 'p1')]), isFalse);
    expect(isFreeDownload(post(requestId: 'r1'), 'q', [req('r9', 'q', fulfilled: 'p1')]), isFalse);
    // someone else's request
    expect(isFreeDownload(post(requestId: 'r1'), 'z', [req('r1', 'q', fulfilled: 'p1')]), isFalse);
  });
}
