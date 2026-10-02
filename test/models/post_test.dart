import 'package:flutter_test/flutter_test.dart';
import 'package:kyoto_exam_hub/models/post.dart';

void main() {
  test('Post round-trips filePaths and no longer carries price or reward flags', () {
    final p = Post(
      id: 'p1', subjectId: 'c_1', subjectName: '線形代数', authorId: 'u1', authorName: 'me',
      category: PostCategory.pastExam, year: 2024, title: 't', description: '',
      filePaths: ['resources/u1/1_a.pdf'], fileNames: ['a.pdf'], createdAt: DateTime.utc(2026, 10, 3),
    );
    final m = p.toMap();
    expect(m['filePaths'], ['resources/u1/1_a.pdf']);
    for (final k in ['fileUrls', 'downloadCost', 'is5DownloadsRewarded', 'is10DownloadsRewarded']) {
      expect(m.containsKey(k), isFalse, reason: '$k must be gone');
    }
    expect(Post.fromMap(m).filePaths, ['resources/u1/1_a.pdf']);
  });

  test('Post.fromMap still reads a legacy doc (fileUrls/downloadCost present, no filePaths)', () {
    final p = Post.fromMap({
      'id': 'old', 'subjectId': 's', 'authorId': 'u', 'category': 'past_exam', 'title': 't',
      'fileUrls': ['https://firebasestorage.googleapis.com/v0/b/x/o/a?alt=media'],
      'fileNames': ['a.pdf'], 'downloadCost': 5, 'downloadCount': 4,
      'is5DownloadsRewarded': true, 'createdAt': '2026-09-01T00:00:00.000',
    });
    expect(p.filePaths, isEmpty); // un-migrated: the UI treats this as "not downloadable"
    expect(p.downloadCount, 4);
  });
}
