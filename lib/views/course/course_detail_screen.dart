import 'package:flutter/material.dart';

import '../../models/subject.dart';
import '../../services/app_store.dart';
import 'course_resource_tab.dart';
import 'course_review_tab.dart';

/// Course detail: a thin 2-tab shell (Task 8).
///
/// Everything that used to live here — the post feed, the upload/request
/// modals, the download/report dialogs — now lives in [CourseResourceTab].
/// The default tab is レビュー (index 0).
class CourseDetailScreen extends StatefulWidget {
  final AppStore store;
  final Subject subject;

  const CourseDetailScreen({
    super.key,
    required this.store,
    required this.subject,
  });

  @override
  State<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends State<CourseDetailScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        iconTheme: const IconThemeData(color: Color(0xFF1E293B)),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.subject.name,
              style: const TextStyle(color: Color(0xFF1E293B), fontWeight: FontWeight.bold, fontSize: 17),
            ),
            Text(
              '${widget.subject.faculty} • ${widget.subject.timeSlotLabel} • ${widget.subject.lecturer}',
              style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
            ),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFF0F4C81),
          unselectedLabelColor: const Color(0xFF64748B),
          indicatorColor: const Color(0xFF0F4C81),
          indicatorWeight: 3,
          tabs: const [
            Tab(text: 'レビュー'),
            Tab(text: '過去問・資料'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Task 7 carry: CourseReviewTab captures currentUser ONCE in
          // initState. If it mounts before async auth resolves, its "my review"
          // stream stays null forever. Keying on the uid forces a fresh State
          // when auth loads.
          CourseReviewTab(
            key: ValueKey('review_${widget.store.currentUser?.uid}'),
            store: widget.store,
            subject: widget.subject,
          ),
          CourseResourceTab(store: widget.store, subject: widget.subject),
        ],
      ),
    );
  }
}
