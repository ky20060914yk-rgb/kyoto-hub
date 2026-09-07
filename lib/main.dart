import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'services/app_store.dart';
import 'views/auth/signup_screen.dart';
import 'views/navigation_root_screen.dart';

import 'views/onboarding/onboarding_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const KyotoExamHubApp());
}

class KyotoExamHubApp extends StatefulWidget {
  const KyotoExamHubApp({super.key});

  @override
  State<KyotoExamHubApp> createState() => _KyotoExamHubAppState();
}

class _KyotoExamHubAppState extends State<KyotoExamHubApp> {
  final AppStore _store = AppStore();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '京大InfoHub - 京大生専用過去問・資料共有',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'Inter',
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F4C81),
          primary: const Color(0xFF0F4C81),
          surface: Colors.white,
        ),
        scaffoldBackgroundColor: const Color(0xFFF8FAFC),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          elevation: 0.5,
          iconTheme: IconThemeData(color: Color(0xFF1E293B)),
          titleTextStyle: TextStyle(
            color: Color(0xFF1E293B),
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      home: ListenableBuilder(
        listenable: _store,
        builder: (context, child) {
          if (_store.currentUser != null) {
            if (_store.showOnboardingFlow) {
              return OnboardingScreen(store: _store);
            }
            return NavigationRootScreen(store: _store);
          }
          return SignupScreen(store: _store);
        },
      ),
    );
  }
}
