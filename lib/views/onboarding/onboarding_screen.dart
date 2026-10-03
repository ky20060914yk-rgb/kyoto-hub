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
      'subtitle': '京大生同士で授業レビュー・過去問の共有や教科書の譲り合いができます。',
      'icon': Icons.school_outlined,
      'color': const Color(0xFF0F4C81),
      'highlight': 'kyoto-u.ac.jp 認証済みユーザー限定',
    },
    {
      'title': '初回 3クレジットプレゼント！',
      'subtitle': 'メール認証を完了すると 3クレジット がもらえます。\n過去問・資料は 1つにつき 1クレジット。授業レビューの閲覧・投稿は、ずっと無料です。',
      'icon': Icons.stars_rounded,
      'color': const Color(0xFFD97706),
      'highlight': 'まず3つの資料が手に入る！',
    },
    {
      'title': '投稿して、クレジットを集めよう',
      'subtitle': '・資料のアップロード: +3クレジット（1日3回まで）\n・最初の3件のレビュー: 各+2クレジット\n・レビューの少ない科目(5件未満・自分で追加した科目を除く)への投稿: +1クレジット\n・リクエストに応える: +3クレジット\n・友だちを招待: あなたも友だちも +3クレジット\nクレジットは購入できません。みんなで資料を持ち寄る仕組みです。',
      'icon': Icons.savings_outlined,
      'color': const Color(0xFF059669),
      'highlight': '投稿すれば、また資料がもらえる！',
    },
    {
      'title': '教科書を譲る・売る・探す',
      'subtitle': '「教科書」タブで、使わなくなった教科書を譲ったり売ったり、欲しい本を「買いたい」で探せます。アプリはお金を扱いません（代金は受け渡し時に直接）。',
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
