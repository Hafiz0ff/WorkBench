import AppKit
import Foundation

final class WorkbenchAppDelegate: NSObject, NSApplicationDelegate {
    private func firstProjectFolder(from filenames: [String]) -> URL? {
        let fm = FileManager.default
        for filename in filenames {
            let url = URL(fileURLWithPath: filename)
            var isDirectory: ObjCBool = false
            if fm.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
                return url
            }
        }
        return nil
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        if let folder = firstProjectFolder(from: filenames) {
            NotificationCenter.default.post(name: .workbenchOpenProject, object: folder)
        }
        sender.reply(toOpenOrPrint: .success)
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        guard let folder = firstProjectFolder(from: [filename]) else {
            return false
        }
        NotificationCenter.default.post(name: .workbenchOpenProject, object: folder)
        return true
    }
}
