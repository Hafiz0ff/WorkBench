import SwiftUI

struct LoadingSkeletonView: View {
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 999, style: .continuous)
                    .fill(Color.primary.opacity(0.09))
                    .frame(width: 220, height: 22)
                RoundedRectangle(cornerRadius: 999, style: .continuous)
                    .fill(Color.primary.opacity(0.07))
                    .frame(width: 160, height: 14)
            }

            GroupBox(title) {
                VStack(alignment: .leading, spacing: 12) {
                    skeletonLine(width: 0.72)
                    skeletonLine(width: 0.95)
                    skeletonLine(width: 0.58)
                    skeletonLine(width: 0.84)
                }
            }

            HStack(spacing: 12) {
                skeletonPill(width: 118)
                skeletonPill(width: 92)
                skeletonPill(width: 144)
            }

            HStack(spacing: 12) {
                skeletonCard()
                skeletonCard()
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func skeletonLine(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 999, style: .continuous)
            .fill(Color.primary.opacity(0.08))
            .frame(maxWidth: .infinity, minHeight: 12, idealHeight: 12, maxHeight: 12, alignment: .leading)
            .scaleEffect(x: width, y: 1, anchor: .leading)
    }

    private func skeletonPill(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 999, style: .continuous)
            .fill(Color.primary.opacity(0.08))
            .frame(width: width, height: 34)
    }

    private func skeletonCard() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            skeletonLine(width: 0.55)
            skeletonLine(width: 0.86)
            skeletonLine(width: 0.72)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: Color.primary.opacity(0.02),
            border: Color.primary.opacity(0.10),
            shadowRadius: 8
        )
    }
}

struct ConfidenceBadgeView: View {
    let confidence: Double?
    let source: String?

    var body: some View {
        if let confidence {
            let percent = Int((max(0, min(1, confidence)) * 100).rounded())
            let tint: Color = confidence >= 0.85 ? .green : confidence >= 0.65 ? .orange : .red
            Text("\(percent)% confidence")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .foregroundStyle(tint)
                .glassSurface(
                    cornerRadius: 999,
                    material: .ultraThinMaterial,
                    tint: tint.opacity(0.04),
                    border: tint.opacity(0.22),
                    borderWidth: 0.9,
                    shadowColor: .clear,
                    shadowRadius: 0,
                    shadowY: 0
                )
                .clipShape(Capsule())
                .help(source ?? "confidence")
        }
    }
}

struct TypewriterTextView: View {
    let text: String
    let isActive: Bool
    let font: Font

    @State private var displayedText = ""
    @State private var animationTask: Task<Void, Never>?

    init(text: String, isActive: Bool, font: Font = .system(.body, design: .monospaced)) {
        self.text = text
        self.isActive = isActive
        self.font = font
    }

    var body: some View {
        Text(displayedText)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .font(font)
            .textSelection(.enabled)
            .task(id: text) {
                await animate(to: text)
            }
            .onChange(of: isActive) { _, _ in
                animationTask?.cancel()
                if !isActive {
                    displayedText = text
                }
            }
    }

    private func animate(to value: String) async {
        animationTask?.cancel()
        let target = String(value)
        guard isActive, target.count <= 1200 else {
            await MainActor.run {
                displayedText = target
            }
            return
        }

        let chunks = Self.chunkText(target)
        await MainActor.run {
            displayedText = ""
        }

        animationTask = Task {
            for chunk in chunks {
                if Task.isCancelled { return }
                await MainActor.run {
                    displayedText += chunk
                }
                let delay: UInt64 = chunk.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 8_000_000 : 18_000_000
                try? await Task.sleep(nanoseconds: delay)
            }
        }
    }

    private static func chunkText(_ text: String) -> [String] {
        var chunks: [String] = []
        var buffer = ""
        var lastWasWhitespace: Bool?

        for character in text {
            let isWhitespace = character.isWhitespace
            if lastWasWhitespace == nil {
                lastWasWhitespace = isWhitespace
            }
            if lastWasWhitespace != isWhitespace {
                chunks.append(buffer)
                buffer = ""
                lastWasWhitespace = isWhitespace
            }
            buffer.append(character)
        }

        if !buffer.isEmpty {
            chunks.append(buffer)
        }
        return chunks
    }
}
