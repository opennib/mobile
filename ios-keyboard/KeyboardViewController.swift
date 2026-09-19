import UIKit

/// Live waveform, after the design's `LiveWave` (M-K-2 recording panel): 36
/// rounded bars in the recording colour, each on its own eased sine cycle so
/// the shape keeps moving, with the whole thing scaled by the mic level the
/// host app publishes — silence settles to a near-flat line, speech fills it.
final class WaveView: UIView {
    private let barCount: Int
    private let gap: CGFloat = 3
    private var bars: [CALayer] = []
    private var displayLink: CADisplayLink?
    private var startTime: CFTimeInterval = 0
    /// Smoothed 0..1 scale applied to every bar; eased toward `targetLevel`.
    private var intensity: CGFloat = 0.15
    var targetLevel: CGFloat = 0.15

    init(bars: Int, color: UIColor) {
        barCount = bars
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        for _ in 0..<bars {
            let layer = CALayer()
            layer.backgroundColor = color.cgColor
            layer.opacity = 0.9
            self.layer.addSublayer(layer)
            self.bars.append(layer)
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        layoutBars(at: CACurrentMediaTime() - startTime)
    }

    func start() {
        guard displayLink == nil else { return }
        startTime = CACurrentMediaTime()
        alpha = 1
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.preferredFramesPerSecond = 30
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    /// Stop animating and dim — the design's frozen wave while transcribing.
    func freeze() {
        displayLink?.invalidate()
        displayLink = nil
        alpha = 0.35
    }

    func reset() {
        freeze()
        intensity = 0.15
        targetLevel = 0.15
        alpha = 1
        layoutBars(at: 0)
    }

    @objc private func tick() {
        // Ease toward the latest level so bars don't pop (matches the app's wave).
        intensity += (max(0.05, min(1, targetLevel)) - intensity) * 0.25
        layoutBars(at: CACurrentMediaTime() - startTime)
    }

    private func layoutBars(at t: CFTimeInterval) {
        let n = CGFloat(barCount)
        let barW = max(2, (bounds.width - (n - 1) * gap) / n)
        let maxH = bounds.height
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, bar) in bars.enumerated() {
            let fi = Double(i)
            // Per-bar peak, period and phase are the design's LiveWave constants.
            let peak = 0.35 + abs(sin(fi * 0.9) + cos(fi * 0.5)) * 0.32
            let period = 0.5 + Double((i * 7) % 5) * 0.13
            let delay = Double((i * 3) % 7) * 0.08
            let wobble = 0.55 + 0.45 * sin((t - delay) / period * 2 * .pi)
            let h = max(3, maxH * CGFloat(min(1, peak * wobble)) * intensity)
            let x = CGFloat(i) * (barW + gap)
            bar.frame = CGRect(x: x, y: (maxH - h) / 2, width: barW, height: h)
            bar.cornerRadius = barW / 2
        }
        CATransaction.commit()
    }

    deinit { displayLink?.invalidate() }
}

/// opennib custom keyboard.
/// - Steady state (host app alive in background): press-and-hold posts a Darwin
///   "recordStart" signal; release posts "recordStop". The host app records,
///   transcribes, and writes a transcript back to the App Group + posts a
///   "transcriptReady" Darwin signal that we read here. User stays in the host
///   text app the whole time.
/// - Cold start (host app not running): the heartbeat in App Group is stale, so
///   we open `opennib://record` to bootstrap. After the first launch the app
///   stays alive in background (UIBackgroundModes=audio) and subsequent taps
///   use the steady-state path.
final class KeyboardViewController: UIInputViewController {

    private static let appGroup = "group.com.opennib.mobile"
    private static let transcriptKey = "com.opennib.mobile.lastTranscript"
    private static let counterKey = "com.opennib.mobile.transcriptCounter"
    private static let heartbeatKey = "com.opennib.mobile.appAliveAt"
    private static let keyboardActivatedKey = "com.opennib.mobile.keyboardEverActivated"
    private static let heartbeatStaleSeconds: TimeInterval = 8.0
    private static let transcriptDarwin = "com.opennib.mobile.transcriptReady" as CFString
    private static let recordStartDarwin = "com.opennib.mobile.recordStart" as CFString
    private static let recordStopDarwin = "com.opennib.mobile.recordStop" as CFString
    private static let audioLevelKey = "com.opennib.mobile.audioLevel"
    private static let audioLevelAtKey = "com.opennib.mobile.audioLevelAt"
    /// Design M-K-2: the recording panel is 290 pt tall with a 300×88 wave.
    private static let panelHeight: CGFloat = 290
    private static let recColor = UIColor(red: 0.84, green: 0.29, blue: 0.17, alpha: 1.0) // rec #d64a2c

    private let micButton = UIButton(type: .system)
    private let nextKeyboardButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let waveView = WaveView(bars: 36, color: KeyboardViewController.recColor)
    private let listeningLabel = UILabel()
    private let listeningDot = UIView()
    private let timerLabel = UILabel()
    private var levelTimer: Timer?
    private var recordingStartedAt: Date?

    private enum Mode {
        case idle, recording, transcribing, bootstrapping
    }
    private var mode: Mode = .idle { didSet { renderMode() } }
    private var lastSeenCounter: Int = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.82, green: 0.84, blue: 0.87, alpha: 1.0) // kbd chrome #d1d6de
        layoutKeyboard()
        registerDarwinObserver()
        lastSeenCounter = sharedDefaults?.integer(forKey: Self.counterKey) ?? 0
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // The keyboard extension only loads after the user has installed it
        // *and* switched to it inside a host app. Stamp the App Group so the
        // host app can stop nagging the user to finish setup.
        sharedDefaults?.set(true, forKey: Self.keyboardActivatedKey)
    }

    deinit {
        levelTimer?.invalidate()
        unregisterDarwinObserver()
    }

    // MARK: - Layout

    private func layoutKeyboard() {
        micButton.translatesAutoresizingMaskIntoConstraints = false
        micButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        micButton.setTitleColor(.white, for: .normal)
        micButton.layer.cornerRadius = 22
        micButton.addTarget(self, action: #selector(handleTouchDown), for: .touchDown)
        micButton.addTarget(self, action: #selector(handleTouchUp),
                            for: [.touchUpInside, .touchUpOutside, .touchCancel])

        nextKeyboardButton.translatesAutoresizingMaskIntoConstraints = false
        nextKeyboardButton.setTitle("🌐", for: .normal)
        nextKeyboardButton.titleLabel?.font = .systemFont(ofSize: 22)
        nextKeyboardButton.addTarget(self, action: #selector(handleInputModeList(from:with:)),
                                     for: .allTouchEvents)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.textColor = UIColor(red: 0.34, green: 0.35, blue: 0.39, alpha: 1) // ink-2 #565a63
        statusLabel.font = .systemFont(ofSize: 11, weight: .medium)
        statusLabel.textAlignment = .center

        // Recording panel pieces (design M-K-2): wave, "● Listening…" row, timer.
        waveView.translatesAutoresizingMaskIntoConstraints = false
        listeningLabel.translatesAutoresizingMaskIntoConstraints = false
        listeningLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        listeningLabel.textColor = UIColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1) // ink #17181c
        listeningLabel.text = "Listening…"
        listeningDot.translatesAutoresizingMaskIntoConstraints = false
        listeningDot.backgroundColor = Self.recColor
        listeningDot.layer.cornerRadius = 4
        timerLabel.translatesAutoresizingMaskIntoConstraints = false
        timerLabel.font = .monospacedDigitSystemFont(ofSize: 10.5, weight: .medium)
        timerLabel.textColor = UIColor(red: 0.34, green: 0.35, blue: 0.39, alpha: 1)
        timerLabel.textAlignment = .center
        timerLabel.text = "0:00"

        view.addSubview(waveView)
        view.addSubview(listeningDot)
        view.addSubview(listeningLabel)
        view.addSubview(timerLabel)
        view.addSubview(micButton)
        view.addSubview(nextKeyboardButton)
        view.addSubview(statusLabel)

        // Extensions get a default height from the system; ask for the design's
        // panel height so the wave has room above the hold button.
        let height = view.heightAnchor.constraint(equalToConstant: Self.panelHeight)
        height.priority = .defaultHigh
        height.isActive = true

        NSLayoutConstraint.activate([
            waveView.topAnchor.constraint(equalTo: view.topAnchor, constant: 26),
            waveView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            waveView.widthAnchor.constraint(equalToConstant: 300),
            waveView.heightAnchor.constraint(equalToConstant: 88),

            listeningLabel.topAnchor.constraint(equalTo: waveView.bottomAnchor, constant: 14),
            listeningLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor, constant: 8),
            listeningDot.centerYAnchor.constraint(equalTo: listeningLabel.centerYAnchor),
            listeningDot.trailingAnchor.constraint(equalTo: listeningLabel.leadingAnchor, constant: -8),
            listeningDot.widthAnchor.constraint(equalToConstant: 8),
            listeningDot.heightAnchor.constraint(equalToConstant: 8),
            timerLabel.topAnchor.constraint(equalTo: listeningLabel.bottomAnchor, constant: 6),
            timerLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

            micButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            micButton.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -14),
            micButton.widthAnchor.constraint(equalToConstant: 240),
            micButton.heightAnchor.constraint(equalToConstant: 56),

            nextKeyboardButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            nextKeyboardButton.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -12),
            nextKeyboardButton.widthAnchor.constraint(equalToConstant: 44),
            nextKeyboardButton.heightAnchor.constraint(equalToConstant: 44),

            statusLabel.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -16),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
        renderMode()
    }

    // MARK: - Touch handlers

    @objc private func handleTouchDown() {
        if isAppAlive() {
            postDarwin(Self.recordStartDarwin)
            mode = .recording
        } else {
            bootstrapMainApp()
            mode = .bootstrapping
        }
    }

    @objc private func handleTouchUp() {
        switch mode {
        case .recording:
            postDarwin(Self.recordStopDarwin)
            mode = .transcribing
        case .bootstrapping:
            // User let go before the host finished launching. They'll record in
            // the app and the regular Linking handler will route through.
            mode = .idle
        default:
            break
        }
    }

    // MARK: - Helpers

    private func isAppAlive() -> Bool {
        guard let defaults = sharedDefaults else { return false }
        let last = defaults.double(forKey: Self.heartbeatKey)
        guard last > 0 else { return false }
        return Date().timeIntervalSince1970 - last < Self.heartbeatStaleSeconds
    }

    private func bootstrapMainApp() {
        guard let url = URL(string: "opennib://record") else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.perform(#selector(UIApplication.open(_:options:completionHandler:)),
                            with: url, with: [:])
                return
            }
            responder = r.next
        }
    }

    private func postDarwin(_ name: CFString) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name), nil, nil, true
        )
    }

    private func renderMode() {
        let showPanel = mode == .recording || mode == .transcribing
        waveView.isHidden = !showPanel
        listeningLabel.isHidden = !showPanel
        listeningDot.isHidden = !showPanel
        timerLabel.isHidden = !showPanel

        switch mode {
        case .idle:
            stopRecordingPanel()
            micButton.setTitle("●  Hold to dictate", for: .normal)
            micButton.backgroundColor = Self.recColor
            statusLabel.text = "opennib · on-device whisper"
        case .recording:
            startRecordingPanel()
            micButton.setTitle("● Recording…", for: .normal)
            micButton.backgroundColor = UIColor(red: 0.70, green: 0.23, blue: 0.13, alpha: 1.0) // rec, pressed-deep
            statusLabel.text = "Release to transcribe"
        case .transcribing:
            freezeRecordingPanel()
            micButton.setTitle("Transcribing…", for: .normal)
            micButton.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.11, alpha: 1.0) // ink #17181c
            statusLabel.text = "Whisper running in opennib"
        case .bootstrapping:
            stopRecordingPanel()
            micButton.setTitle("Opening opennib…", for: .normal)
            micButton.backgroundColor = UIColor(red: 0.88, green: 0.57, blue: 0.16, alpha: 1.0) // wake amber #e0922a
            statusLabel.text = "First tap — open the app once, then come back"
        }
    }

    // MARK: - Recording panel (wave + listening row + timer)

    /// The keyboard cannot hear the mic (sandboxed), so the host publishes its
    /// recorder level into the App Group at ~12 fps; we sample it at 20 fps and
    /// feed the wave. A stale sample (> 0.4 s) means the host stopped
    /// publishing — settle to the idle wobble rather than freezing mid-wave.
    private func startRecordingPanel() {
        recordingStartedAt = Date()
        listeningLabel.text = "Listening…"
        timerLabel.text = "0:00"
        waveView.reset()
        waveView.start()
        pulse(listeningDot, on: true)
        levelTimer?.invalidate()
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if let defaults = self.sharedDefaults {
                let at = defaults.double(forKey: Self.audioLevelAtKey)
                let fresh = Date().timeIntervalSince1970 - at < 0.4
                self.waveView.targetLevel = fresh ? CGFloat(defaults.double(forKey: Self.audioLevelKey)) : 0.15
            }
            if let started = self.recordingStartedAt {
                let secs = Int(Date().timeIntervalSince(started))
                self.timerLabel.text = String(format: "%d:%02d", secs / 60, secs % 60)
            }
        }
    }

    private func freezeRecordingPanel() {
        levelTimer?.invalidate()
        levelTimer = nil
        listeningLabel.text = "Transcribing…"
        pulse(listeningDot, on: false)
        waveView.freeze()
    }

    private func stopRecordingPanel() {
        levelTimer?.invalidate()
        levelTimer = nil
        recordingStartedAt = nil
        pulse(listeningDot, on: false)
        waveView.reset()
    }

    /// The design's `recPulse` on the status dot: 1.4 s ease-out, repeating.
    private func pulse(_ view: UIView, on: Bool) {
        view.layer.removeAnimation(forKey: "recPulse")
        guard on else { return }
        let anim = CABasicAnimation(keyPath: "opacity")
        anim.fromValue = 1
        anim.toValue = 0.25
        anim.duration = 1.4
        anim.timingFunction = CAMediaTimingFunction(name: .easeOut)
        anim.repeatCount = .infinity
        view.layer.add(anim, forKey: "recPulse")
    }

    // MARK: - Transcript ingest

    private func registerDarwinObserver() {
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            observer,
            { _, observer, _, _, _ in
                guard let observer = observer else { return }
                let me = Unmanaged<KeyboardViewController>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async { me.consumeTranscriptIfNew() }
            },
            Self.transcriptDarwin, nil, .deliverImmediately
        )
    }

    private func unregisterDarwinObserver() {
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            observer, nil, nil
        )
    }

    private func consumeTranscriptIfNew() {
        guard let defaults = sharedDefaults else { return }
        let counter = defaults.integer(forKey: Self.counterKey)
        guard counter > lastSeenCounter else { return }
        lastSeenCounter = counter
        guard let text = defaults.string(forKey: Self.transcriptKey), !text.isEmpty else {
            mode = .idle
            statusLabel.text = "No speech detected"
            return
        }
        textDocumentProxy.insertText(text)
        mode = .idle
        statusLabel.text = "Inserted ✓"
    }

    private var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: Self.appGroup)
    }
}
