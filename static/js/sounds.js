// ── Synthesized Sound Effects (Web Audio API) ──
// No external audio files needed. All sounds are short, procedurally generated tones.

(function () {
    "use strict";

    let audioCtx = null;

    function getCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    // Ensure AudioContext is resumed on first user interaction
    function ensureResumed() {
        const ctx = getCtx();
        if (ctx.state === "suspended") {
            ctx.resume();
        }
    }

    // ── Utility: play a tone ──
    function playTone(freq, duration, type, volume, rampDown) {
        try {
            const ctx = getCtx();
            if (ctx.state === "suspended") return; // Don't play if not yet resumed

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type || "sine";
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(volume || 0.12, ctx.currentTime);

            if (rampDown !== false) {
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            }

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            // Silently fail – sounds are optional
        }
    }

    // ── Sound: Card played (soft click) ──
    function playCardSound() {
        playTone(800, 0.06, "square", 0.06);
        setTimeout(() => playTone(600, 0.04, "square", 0.04), 30);
    }

    // ── Sound: Bid placed (gentle chime) ──
    function bidPlacedSound() {
        playTone(523, 0.12, "sine", 0.1);
        setTimeout(() => playTone(659, 0.12, "sine", 0.08), 80);
    }

    // ── Sound: Trick won (ascending two-note) ──
    function trickWinSound() {
        playTone(440, 0.15, "sine", 0.1);
        setTimeout(() => playTone(660, 0.2, "sine", 0.12), 120);
    }

    // ── Sound: Your turn (gentle ping) ──
    function yourTurnSound() {
        playTone(880, 0.08, "sine", 0.08);
        setTimeout(() => playTone(1100, 0.12, "sine", 0.1), 60);
    }

    // ── Sound: Round complete (three-note fanfare) ──
    function roundCompleteSound() {
        playTone(523, 0.15, "sine", 0.1);
        setTimeout(() => playTone(659, 0.15, "sine", 0.1), 120);
        setTimeout(() => playTone(784, 0.25, "sine", 0.12), 240);
    }

    // ── Sound: Game over (triumphant chord) ──
    function gameOverSound() {
        playTone(523, 0.3, "sine", 0.1);
        playTone(659, 0.3, "sine", 0.08);
        playTone(784, 0.3, "sine", 0.08);
        setTimeout(() => {
            playTone(523 * 2, 0.4, "sine", 0.1);
            playTone(659 * 2, 0.4, "sine", 0.06);
        }, 250);
    }

    // ── Export to global scope ──
    window.GameSounds = {
        ensureResumed,
        playCardSound,
        bidPlacedSound,
        trickWinSound,
        yourTurnSound,
        roundCompleteSound,
        gameOverSound,
    };
})();
