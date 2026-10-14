import SwiftUI

struct SignInView: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case signUp = "Create account"
        var id: Self { self }
    }

    let model: AppModel
    @State private var mode = Mode.signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isSubmitting = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "externaldrive.badge.icloud")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("Effect Drive").font(.title)

            Picker("", selection: $mode) {
                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Form {
                if mode == .signUp {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                }
                TextField("Email", text: $email)
                    .textContentType(.username)
                SecureField("Password", text: $password)
                    .textContentType(mode == .signUp ? .newPassword : .password)
            }
            .disabled(isSubmitting)

            if let message = error ?? model.signInNotice {
                Text(message)
                    .foregroundStyle(error == nil ? Color.secondary : Color.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await submit() }
            } label: {
                if isSubmitting {
                    ProgressView().controlSize(.small)
                } else {
                    Text(mode.rawValue).frame(maxWidth: .infinity)
                }
            }
            .keyboardShortcut(.defaultAction)
            .controlSize(.large)
            .disabled(!canSubmit || isSubmitting)
        }
        .frame(width: 320)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: mode) { error = nil }
    }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
            && (mode == .signIn || !name.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    private func submit() async {
        isSubmitting = true
        defer { isSubmitting = false }
        error = nil
        let email = email.trimmingCharacters(in: .whitespaces)
        do {
            switch mode {
            case .signIn:
                try await model.signIn(email: email, password: password)
            case .signUp:
                try await model.signUp(name: name.trimmingCharacters(in: .whitespaces), email: email, password: password)
            }
            password = ""
        } catch {
            self.error = error.message
        }
    }
}
