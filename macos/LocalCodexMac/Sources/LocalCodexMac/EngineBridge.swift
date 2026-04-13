import Foundation

final class OutputAccumulator: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock()
        data.append(chunk)
        lock.unlock()
    }

    func string() -> String {
        lock.lock()
        let copy = data
        lock.unlock()
        return String(decoding: copy, as: UTF8.self)
    }

    func drain() -> String {
        lock.lock()
        let copy = data
        data.removeAll(keepingCapacity: true)
        lock.unlock()
        return String(decoding: copy, as: UTF8.self)
    }
}

struct EngineCommandResult {
    var command: String
    var arguments: [String]
    var exitCode: Int32
    var stdout: String
    var stderr: String
}

final class EngineBridge: @unchecked Sendable {
    let engineRoot: URL
    let cliURL: URL

    init(engineRoot: URL) {
        self.engineRoot = engineRoot
        self.cliURL = engineRoot.appendingPathComponent("src/cli.js")
    }

    static func detectEngineRoot(startingAt url: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)) -> URL? {
        var current = url.standardizedFileURL
        let fm = FileManager.default
        while true {
            let cliCandidate = current.appendingPathComponent("src/cli.js")
            if fm.fileExists(atPath: cliCandidate.path) {
                return current
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path {
                return nil
            }
            current = parent
        }
    }

    func runCLI(arguments: [String], currentDirectory: URL? = nil, environment: [String: String] = [:]) async throws -> EngineCommandResult {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let stdoutData = OutputAccumulator()
            let stderrData = OutputAccumulator()

            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", cliURL.path] + arguments
            process.currentDirectoryURL = currentDirectory ?? engineRoot
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe
            process.environment = ProcessInfo.processInfo.environment.merging(environment, uniquingKeysWith: { _, new in new })

            stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
                stdoutData.append(handle.availableData)
            }
            stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                stderrData.append(handle.availableData)
            }

            process.terminationHandler = { proc in
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(returning: EngineCommandResult(
                    command: "node",
                    arguments: arguments,
                    exitCode: proc.terminationStatus,
                    stdout: stdoutData.string(),
                    stderr: stderrData.string()
                ))
            }

            do {
                try process.run()
            } catch {
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(throwing: error)
            }
        }
    }
}
