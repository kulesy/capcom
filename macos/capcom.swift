// Capcom.app's executable. Given a command, it runs it and stays its parent, which makes Capcom the app
// macOS asks about permissions for, for the server and every session under it. Given none, it asks for them.
import EventKit
import Foundation

nonisolated(unsafe) var child: pid_t = 0

// NOTE: [16 Oct 2026] EK - Spawn, never exec. macOS credits the process at the root of the tree, so an exec
// would make the server plain node again, with no permissions. See docs/adr/20261016-capcom-app-for-macos-permissions.md.
func serve(_ command: [String]) -> Never {
  for sig in [SIGTERM, SIGINT, SIGHUP] { signal(sig) { sig in if child > 0 { kill(child, sig) } } }
  var argv = command.map { strdup($0) } + [nil]
  let failed = posix_spawnp(&child, command[0], nil, nil, &argv, environ)
  if failed != 0 {
    fputs("capcom: cannot start \(command[0]): \(String(cString: strerror(failed)))\n", stderr)
    exit(127)
  }
  var status: Int32 = 0
  while waitpid(child, &status, 0) == -1 && errno == EINTR {}
  let signalled = status & 0x7f
  exit(signalled == 0 ? (status >> 8) & 0xff : 128 + signalled)
}

func calendar() -> String {
  let store = EKEventStore()
  let answered = DispatchSemaphore(value: 0)
  store.requestFullAccessToEvents { _, _ in answered.signal() }
  let timedOut = withExtendedLifetime(store) { answered.wait(timeout: .now() + 300) == .timedOut }
  if timedOut { return "no answer" }
  return EKEventStore.authorizationStatus(for: .event) == .fullAccess ? "allowed" : "not allowed"
}

func folder(_ name: String) -> String {
  let path = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(name).path
  return (try? FileManager.default.contentsOfDirectory(atPath: path)) == nil ? "not allowed" : "allowed"
}

// macOS can only ask about an app that is running, and opening one just to ask would surprise.
func control(_ bundleID: String) -> String {
  let target = NSAppleEventDescriptor(bundleIdentifier: bundleID)
  switch AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, true) {
  case noErr: return "allowed"
  case OSStatus(procNotFound): return "not running, so macOS asks the first time a session uses it"
  default: return "not allowed"
  }
}

func ask() {
  print("Calendar:", calendar())
  for name in ["Desktop", "Documents", "Downloads"] { print("\(name) folder:", folder(name)) }
  for (name, id) in [("Calendar", "com.apple.iCal"), ("Google Chrome", "com.google.Chrome")] { print("Control \(name):", control(id)) }
}

// Opening the app from Finder can add a -psn_ argument.
let command = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-psn_") }
if command.isEmpty {
  // EventKit can answer on the main queue, so the asking runs off it.
  Thread.detachNewThread { ask(); exit(0) }
  dispatchMain()
}
serve(Array(command))
