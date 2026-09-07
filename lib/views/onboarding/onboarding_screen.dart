import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../timetable/timetable_registration_screen.dart';

class OnboardingScreen extends StatefulWidget {
  final AppStore store;

  const OnboardingScreen({super.key, required this.store});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  final List<Map<String, dynamic>> _slides = [
    {
      'title': '京都大学生専用コミュニティ',
      'subtitle': '京大生同士で過去問・テスト対策資料の共有や参考書の貸し借りがスムーズに行えます。',
      'icon': Icons.school_outlined,
      'color': const Color(0xFF0F4C81),
      'highlight': 'kyoto-u.ac.jp 認証済みユーザー限定',
    },
    {
      'title': '初期特典 30pt プレゼント！',
      'subtitle': '過去問は1年度あたり 5pt 固定。\n新規登録時に付与された 30pt で、お好きな科目の過去問を【約6年分】ダウンロードできます！',
      'icon': Icons.stars_rounded,
      'color': const Color(0xFFD97706),
      'highlight': '過去問6年分がすぐ手に入る！',
    },
    {
      'title': 'ポイント経済システム',
      'subtitle': '・過去問: 1年度あたり 5pt 固定\n・テスト対策/その他: 0〜20pt で投稿者が自由設定\n・投稿者に80%還元！資料を投稿して獲得したポイントは、資料DLのほか、サークルやイベントの宣伝広告掲載にも利用可能です。',
      'icon': Icons.savings_outlined,
      'color': const Color(0xFF059669),
      'highlight': '投稿すればポイントがどんどん貯まる！',
    },
    {
      'title': '参考書の貸し借りもサポート',
      'subtitle': '不要になった参考書や探している本をリクエスト掲示板でマッチング！応答時に20pt決済され、安全な個別トークルームが開設されます。',
      'icon': Icons.menu_book_rounded,
      'color': const Color(0xFF2563EB),
      'highlight': 'キャンパス内での受け渡しを円滑に！',
    },
  ];

  void _nextPage() {
    if (_currentPage < _slides.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _finishOnboarding();
    }
  }

  void _finishOnboarding() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => TimetableRegistrationScreen(store: widget.store),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            // Top Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    '京大InfoHub ガイド',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: Color(0xFF0F4C81),
                    ),
                  ),
                  TextButton(
                    onPressed: _finishOnboarding,
                    child: const Text(
                      'スキップ',
                      style: TextStyle(color: Color(0xFF64748B)),
                    ),
                  ),
                ],
              ),
            ),

            // Page View
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                onPageChanged: (idx) {
                  setState(() {
                    _currentPage = idx;
                  });
                },
                itemCount: _slides.length,
                itemBuilder: (context, index) {
                  final slide = _slides[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 100,
                          height: 100,
                          decoration: BoxDecoration(
                            color: (slide['color'] as Color).withAlpha(20),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            slide['icon'] as IconData,
                            size: 56,
                            color: slide['color'] as Color,
                          ),
                        ),
                        const SizedBox(height: 32),
                        Text(
                          slide['title'] as String,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1E293B),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          decoration: BoxDecoration(
                            color: (slide['color'] as Color).withAlpha(15),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            slide['highlight'] as String,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: slide['color'] as Color,
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          slide['subtitle'] as String,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 14,
                            height: 1.6,
                            color: Color(0xFF475569),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),

            // Bottom controls
            Padding(
              padding: const EdgeInsets.all(28.0),
              child: Column(
                children: [
                  // Page Indicators
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      _slides.length,
                      (i) => AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        width: _currentPage == i ? 24 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _currentPage == i ? const Color(0xFF0F4C81) : const Color(0xFFCBD5E1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _nextPage,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0F4C81),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        elevation: 0,
                      ),
                      child: Text(
                        _currentPage == _slides.length - 1 ? '時間割登録へ進む' : '次へ',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
