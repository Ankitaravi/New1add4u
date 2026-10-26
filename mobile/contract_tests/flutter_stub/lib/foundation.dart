/// Minimal copy of Flutter's ChangeNotifier contract (addListener / removeListener / notifyListeners).
class ChangeNotifier {
  final List<void Function()> _listeners = [];

  void addListener(void Function() l) => _listeners.add(l);
  void removeListener(void Function() l) => _listeners.remove(l);
  void notifyListeners() {
    for (final l in List.of(_listeners)) {
      l();
    }
  }

  void dispose() => _listeners.clear();
}
