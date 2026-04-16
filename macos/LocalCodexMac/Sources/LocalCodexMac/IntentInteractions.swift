import AppKit
import SwiftUI

enum IntentMotion {
    static let press = Animation.interactiveSpring(
        response: 0.24,
        dampingFraction: 0.82,
        blendDuration: 0.08
    )

    static let selection = Animation.easeInOut(duration: 0.18)

    static let reveal = Animation.interactiveSpring(
        response: 0.30,
        dampingFraction: 0.88,
        blendDuration: 0.10
    )
}

struct IntentButtonStyle: ButtonStyle {
    enum Variant {
        case text
        case secondary
        case primary
        case danger
    }

    let variant: Variant

    init(variant: Variant = .text) {
        self.variant = variant
    }

    func makeBody(configuration: Configuration) -> some View {
        let isPressed = configuration.isPressed
        let pressedScale: CGFloat = switch variant {
        case .text:
            0.985
        case .secondary:
            0.98
        case .primary, .danger:
            0.975
        }

        let background: AnyShapeStyle = switch variant {
        case .text:
            AnyShapeStyle(.clear)
        case .secondary:
            AnyShapeStyle(Color(nsColor: .controlBackgroundColor).opacity(0.32))
        case .primary:
            AnyShapeStyle(Color.accentColor.opacity(0.92))
        case .danger:
            AnyShapeStyle(Color.red.opacity(0.90))
        }

        let foreground: Color = switch variant {
        case .text, .secondary:
            .primary
        case .primary, .danger:
            .white
        }

        let stroke: Color = switch variant {
        case .text:
            .clear
        case .secondary:
            Color.primary.opacity(0.10)
        case .primary:
            Color.white.opacity(0.16)
        case .danger:
            Color.white.opacity(0.14)
        }

        let horizontalPadding: CGFloat = switch variant {
        case .text:
            0
        case .secondary, .primary, .danger:
            12
        }

        let verticalPadding: CGFloat = switch variant {
        case .text:
            0
        case .secondary, .primary, .danger:
            9
        }

        return configuration.label
            .foregroundStyle(foreground)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(background)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            }
            .scaleEffect(isPressed ? pressedScale : 1)
            .offset(y: isPressed ? 1 : 0)
            .shadow(
                color: .black.opacity(isPressed ? 0.04 : 0.08),
                radius: variant == .text ? 0 : (isPressed ? 4 : 9),
                y: variant == .text ? 0 : (isPressed ? 1 : 4)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .animation(IntentMotion.press, value: isPressed)
    }
}

extension ButtonStyle where Self == IntentButtonStyle {
    static func intent(_ variant: IntentButtonStyle.Variant = .text) -> IntentButtonStyle {
        IntentButtonStyle(variant: variant)
    }
}
