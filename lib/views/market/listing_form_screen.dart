import 'package:flutter/material.dart';

import '../../models/subject.dart';
import '../../models/textbook_listing.dart';
import '../../services/app_store.dart';
import '../../services/market_service.dart';
import '../../utils/file_picker_helper.dart';

const _brand = Color(0xFF0F4C81);

/// 出品する (Plan 3, spec §4.4): 譲る / 売る / 買いたい, free-text title,
/// optional course, condition, price (売る; 定価 is the recommended cap), up to
/// 3 photos, handoff-place preset. The server validates everything again and
/// owns the document; the form only collects and pre-checks.
class ListingFormScreen extends StatefulWidget {
  const ListingFormScreen({super.key, required this.store});

  final AppStore store;

  @override
  State<ListingFormScreen> createState() => _ListingFormScreenState();
}

class _ListingFormScreenState extends State<ListingFormScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _price = TextEditingController();
  final _listPrice = TextEditingController();
  ListingType _type = ListingType.sell;
  BookCondition? _condition;
  String _place = 'clock_tower';
  String _courseId = '';
  List<Subject> _courses = const [];
  final List<String> _photos = [];
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.store.getRegisteredSubjects().then((c) {
      if (mounted) setState(() => _courses = c);
    }).catchError((_) {});
    for (final c in [_title, _description, _price, _listPrice]) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in [_title, _description, _price, _listPrice]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _int(TextEditingController c) => int.tryParse(c.text.trim());

  ListingDraft get _draft => ListingDraft(
        type: _type,
        title: _title.text,
        description: _description.text,
        courseId: _courseId,
        condition: _type == ListingType.want ? null : _condition,
        price: _type == ListingType.give ? null : _int(_price),
        listPrice: _int(_listPrice),
        place: _place,
        photoPaths: List.of(_photos),
      );

  Future<void> _addPhoto() async {
    final picked = await pickFile();
    if (picked == null) return;
    setState(() => _busy = true);
    final path = await widget.store.uploadListingPhoto(picked.name, picked.bytes);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (path != null) _photos.add(path);
      _error = path == null ? widget.store.lastNoticeMessage : null;
    });
  }

  Future<void> _submit() async {
    final draft = _draft;
    final invalid = validateListingDraft(draft);
    if (invalid != null) {
      setState(() => _error = invalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.store.market.createListing(draft);
      if (!mounted) return;
      Navigator.pop(context, true);
    } on MarketException catch (e) {
      if (mounted) setState(() => _error = e.notice);
    } catch (_) {
      if (mounted) setState(() => _error = '出品できませんでした。通信環境を確認してください。');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 6),
        child: Text(t, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF334155))),
      );

  Widget _chips<T>(Iterable<T> values, T selected, String Function(T) label, void Function(T) onSelect) => Wrap(
        spacing: 6,
        runSpacing: 4,
        children: [
          for (final v in values)
            ChoiceChip(
              label: Text(label(v), style: const TextStyle(fontSize: 12)),
              selected: v == selected,
              onSelected: (_) => setState(() => onSelect(v)),
            ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final d = _draft;
    final contact = containsContactInfo('${_title.text} ${_description.text}');
    final overList = d.type == ListingType.sell && d.price != null && d.listPrice != null && d.price! > d.listPrice!;
    return Scaffold(
      appBar: AppBar(title: const Text('教科書を出品する')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFFFBEB), borderRadius: BorderRadius.circular(10)),
              child: const Text(
                '出品できるのは教科書・参考書だけです。アプリはお金を扱いません（決済・手数料なし）。代金は受け渡しのときに当事者どうしで直接やりとりしてください。',
                style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
              ),
            ),
            _label('出品の種類'),
            _chips(ListingType.values, _type, (t) => t.label, (t) => _type = t),
            _label('本のタイトル'),
            TextField(
              controller: _title,
              maxLength: kListingMaxTitle,
              decoration: const InputDecoration(hintText: '例: 線形代数入門 第2版（東京大学出版会）', border: OutlineInputBorder()),
            ),
            _label('関連する科目（任意・時間割から）'),
            _chips<String>(['', ..._courses.map((c) => c.id)], _courseId,
                (id) => id.isEmpty ? '指定しない' : _courses.firstWhere((c) => c.id == id).name, (id) => _courseId = id),
            if (_type != ListingType.want) ...[
              _label('本の状態'),
              _chips<BookCondition?>(BookCondition.values, _condition, (c) => c!.label, (c) => _condition = c),
            ],
            if (_type != ListingType.give) ...[
              _label(_type == ListingType.sell ? '価格（円）' : '予算（円・任意）'),
              TextField(
                controller: _price,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '例: 1500'),
              ),
            ],
            if (_type == ListingType.sell) ...[
              _label('定価（円・任意）'),
              TextField(
                controller: _listPrice,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '定価以下の価格をおすすめします'),
              ),
              if (overList)
                const Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text('定価より高い価格になっています。', style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
                ),
            ],
            _label('受け渡し場所'),
            _chips(kHandoffPlaces.keys, _place, (k) => kHandoffPlaces[k]!, (k) => _place = k),
            _label('説明（任意）'),
            TextField(
              controller: _description,
              maxLines: 4,
              maxLength: kListingMaxDescription,
              decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '書き込みの有無、版、受け渡し可能な曜日など'),
            ),
            if (contact)
              const Text('電話番号・メールアドレス・LINE IDなどは書かないでください（チャットで相談できます）。',
                  style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
            _label('写真（任意・3枚まで・各2MBまで）'),
            Row(
              children: [
                Text('${_photos.length}/$kListingMaxPhotos 枚', style: const TextStyle(fontSize: 12)),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: _busy || _photos.length >= kListingMaxPhotos ? null : _addPhoto,
                  icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                  label: const Text('写真を追加'),
                ),
              ],
            ),
            const Text('写真は京大生なら誰でも見られます。顔・学生証・住所が写らないようにしてください。',
                style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _busy ? null : _submit,
                style: ElevatedButton.styleFrom(backgroundColor: _brand, foregroundColor: Colors.white),
                child: const Text('出品する', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
