import 'package:flutter/material.dart';
import '../services/app_store.dart';
import 'search/search_screen.dart';
import 'home/home_screen.dart';
import 'mypage/my_page_screen.dart';
import 'market/market_screen.dart';

class NavigationRootScreen extends StatefulWidget {
  final AppStore store;

  const NavigationRootScreen({super.key, required this.store});

  @override
  State<NavigationRootScreen> createState() => _NavigationRootScreenState();
}

class _NavigationRootScreenState extends State<NavigationRootScreen> {
  int _currentIndex = 0;
  bool _isCheckingVerification = false;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_onStoreUpdated);
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreUpdated);
    super.dispose();
  }

  void _onStoreUpdated() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.store.currentUser;
    final isUnverified = user != null && !user.isVerified;

    final screens = [
      SearchScreen(store: widget.store),
      HomeScreen(store: widget.store),
      MarketScreen(store: widget.store), // Plan 3: the textbook market is its own tab (spec §4.1)
      MyPageScreen(store: widget.store),
    ];

    return Scaffold(
      appBar: isUnverified
          ? PreferredSize(
              preferredSize: const Size.fromHeight(64),
              child: SafeArea(
                child: Container(
                  color: const Color(0xFFFEF3C7),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, color: Color(0xFFD97706), size: 22),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'メールアドレス未検証です。機能を制限中。',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF92400E)),
                        ),
                      ),
                      TextButton(
                        onPressed: _isCheckingVerification
                            ? null
                            : () async {
                                // The reload/token-refresh inside
                                // checkEmailVerification() can throw when the
                                // network is down. Without the try/finally the
                                // loading flag would stay true and this button
                                // would be disabled for the rest of the session
                                // with no way to recover (I2).
                                setState(() => _isCheckingVerification = true);
                                bool verified = false;
                                bool failed = false;
                                try {
                                  verified = await widget.store.checkEmailVerification();
                                } catch (_) {
                                  failed = true;
                                } finally {
                                  if (mounted) {
                                    setState(() => _isCheckingVerification = false);
                                  }
                                }
                                if (!mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      failed
                                          ? '通信エラーが発生しました。通信環境を確認して再試行してください。'
                                          : verified
                                              ? 'メールアドレスが正常に認証されました！'
                                              : 'まだメール認証が完了していません。',
                                    ),
                                  ),
                                );
                              },
                        style: TextButton.styleFrom(
                          backgroundColor: const Color(0xFFD97706),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                        ),
                        child: const Text('認証確認', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.refresh_rounded, color: Color(0xFFD97706), size: 20),
                        onPressed: () async {
                          await widget.store.resendVerificationEmail();
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('確認メールを再送信しました。')),
                            );
                          }
                        },
                        tooltip: 'メールを再送信',
                      ),
                    ],
                  ),
                ),
              ),
            )
          : null,
      body: IndexedStack(
        index: _currentIndex,
        children: screens,
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 1)),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (index) => setState(() => _currentIndex = index),
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.white,
          selectedItemColor: const Color(0xFF0F4C81),
          unselectedItemColor: const Color(0xFF94A3B8),
          selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11),
          unselectedLabelStyle: const TextStyle(fontSize: 11),
          items: [
            const BottomNavigationBarItem(
              icon: Icon(Icons.search_outlined),
              activeIcon: Icon(Icons.search_rounded),
              label: 'さがす',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.calendar_today_outlined),
              activeIcon: Icon(Icons.calendar_today_rounded),
              label: '時間割',
            ),
            BottomNavigationBarItem(
              icon: Badge(
                isLabelVisible: widget.store.unreadRoomCount > 0,
                label: Text('${widget.store.unreadRoomCount}'),
                child: const Icon(Icons.menu_book_outlined),
              ),
              activeIcon: const Icon(Icons.menu_book_rounded),
              label: '教科書',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.person_outline),
              activeIcon: Icon(Icons.person_rounded),
              label: 'マイページ',
            ),
          ],
        ),
      ),
    );
  }
}
