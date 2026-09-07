import 'dart:typed_data';

class PickedFile {
  final String name;
  final Uint8List bytes;

  PickedFile({required this.name, required this.bytes});
}

Future<PickedFile?> pickFile() async {
  return null;
}
