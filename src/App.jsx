import { memo, useEffect, useRef, useState } from "react";
import cryingCharacter from "./assets/crying-character.png";
import distressedCharacter from "./assets/crying-character-distressed.png";
import gameOverCharacter from "./assets/crying-character-gameover.png";
import floodCrowd from "./assets/flood-crowd.png";
import handkerchiefCursor from "./assets/handkerchief-kumusta-ka.png";
import tearDropImage from "./assets/tear-drop.png";
import welcomeMusic from "./assets/welcome-music.mp3";
import wipeDropSfx from "./assets/wipe-drop.mp3";
import missedCrySfx from "./assets/missed-cry.mp3";
import gameOverSfx from "./assets/game-over.mp3";

const BUCKET_LIMIT = 8;
const BUCKET_HEIGHT = 136;
const BUCKET_BOTTOM_OFFSET = 0;
const WIPE_RADIUS = 34;
const TEAR_SOURCES = [0.12, 0.26, 0.4, 0.6, 0.74, 0.88];
const CHARACTER_DIALOGUE = [
  "Takot na takot po ako!",
  "Napakarami nang nangyare!",
  "Wala ho akong sinisisi!",
  "Walang ni isa sa inyong nangumusta sa amin",
  "HUHUHU...",
  "Some of you I know for 20 years",
  "I didn't hear any of you!",
];

const initialGame = {
  status: "idle",
  elapsedMs: 0,
  totalTimeMs: 0,
  bucketDrops: 0,
  wipedTears: 0,
  spawnMs: 900,
  fallSpeed: 220,
  feedback: "sdfsdf",
};

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getSpawnMs(elapsedMs) {
  return Math.max(320, 920 - elapsedMs / 120);
}

function getFallSpeed(elapsedMs) {
  return 130 + elapsedMs / 260;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createTear(id, stageWidth, elapsedMs, source = null, laneOffset = 0) {
  const sourceRatio =
    source ?? TEAR_SOURCES[Math.floor(Math.random() * TEAR_SOURCES.length)];
  const size = randomBetween(18, 28);
  const x = clamp(
    stageWidth * sourceRatio +
      laneOffset * 18 +
      randomBetween(-stageWidth * 0.04, stageWidth * 0.04),
    size,
    stageWidth - size,
  );

  return {
    id,
    x,
    y: -size,
    size,
    drift: randomBetween(-26, 26),
    speed: getFallSpeed(elapsedMs) * randomBetween(0.9, 1.18),
  };
}

function createSpawnBatch(stageWidth, elapsedMs, nextTearIdRef) {
  const parallelChance = Math.min(0.2 + elapsedMs / 90_000, 0.45);
  const shouldSpawnParallel = Math.random() < parallelChance;

  if (!shouldSpawnParallel) {
    const tear = createTear(nextTearIdRef.current, stageWidth, elapsedMs);
    nextTearIdRef.current += 1;
    return [tear];
  }

  const tripleChance = Math.min(0.08 + elapsedMs / 140_000, 0.2);
  const count = Math.random() < tripleChance ? 3 : 2;
  const startIndex = Math.floor(
    Math.random() * (TEAR_SOURCES.length - count + 1),
  );

  return TEAR_SOURCES.slice(startIndex, startIndex + count).map(
    (source, index) => {
      const tear = createTear(
        nextTearIdRef.current,
        stageWidth,
        elapsedMs,
        source,
        index - (count - 1) / 2,
      );

      nextTearIdRef.current += 1;
      return tear;
    },
  );
}

function getCharacterMood(status, bucketDrops) {
  if (status === "gameover") {
    return "gameover";
  }

  if (bucketDrops >= 5) {
    return "warning";
  }

  return "crying";
}

function getInitialStageHeight() {
  if (typeof window === "undefined") {
    return 560;
  }

  return window.innerWidth <= 760 ? 360 : 670;
}

function getPerformanceMode() {
  if (typeof window === "undefined") {
    return false;
  }

  const ua = window.navigator.userAgent ?? "";
  const isAndroid = /Android/i.test(ua);
  const lowMemory =
    typeof window.navigator.deviceMemory === "number" &&
    window.navigator.deviceMemory <= 4;
  const lowCpu =
    typeof window.navigator.hardwareConcurrency === "number" &&
    window.navigator.hardwareConcurrency <= 6;

  return isAndroid || (window.innerWidth <= 760 && (lowMemory || lowCpu));
}

function shouldShowWipeCursor(performanceMode) {
  if (typeof window === "undefined") {
    return true;
  }

  return !performanceMode && window.matchMedia("(pointer: fine)").matches;
}

const GameSidebar = memo(function GameSidebar({
  currentMood,
  speech,
  portraitSource,
  showDistressedFace,
}) {
  return (
    <aside className={`sidebar-panel game-sidebar mood-${currentMood}`}>
      <div className="character-dialogue-wrap">
        <div className="speech-bubble">{speech}</div>

        <div
          className={`portrait-card game-portrait-card ${showDistressedFace ? "is-distressed" : ""}`}
        >
          <img
            className="character-image"
            src={portraitSource}
            alt="Pixel-art crying character"
          />
        </div>
      </div>
    </aside>
  );
});

export default function App() {
  const [game, setGame] = useState(initialGame);
  const [tears, setTears] = useState([]);
  const [soundOn, setSoundOn] = useState(false);
  const [showSoundPrompt, setShowSoundPrompt] = useState(true);
  const [performanceMode, setPerformanceMode] = useState(getPerformanceMode);
  const [showWipeCursor, setShowWipeCursor] = useState(() =>
    shouldShowWipeCursor(getPerformanceMode()),
  );

  const audioContextRef = useRef(null);
  const masterGainRef = useRef(null);
  const welcomeMusicRef = useRef(null);
  const wipeSfxRef = useRef([]);
  const missedCryRef = useRef([]);
  const gameOverSfxRef = useRef(null);
  const activeEffectRef = useRef({ kind: null, audio: null });
  const soundOnRef = useRef(false);
  const pendingWelcomeUnlockRef = useRef(false);
  const stageRef = useRef(null);
  const floodSceneRef = useRef(null);
  const wipeCursorRef = useRef(null);
  const showWipeCursorRef = useRef(showWipeCursor);
  const animationRef = useRef(0);
  const runStartedAtRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const lastSpawnAtRef = useRef(0);
  const nextTearIdRef = useRef(1);
  const tearsRef = useRef([]);
  const bucketDropsRef = useRef(0);
  const wipedTearsRef = useRef(0);
  const statusRef = useRef(initialGame.status);
  const stageSizeRef = useRef({
    width: 300,
    height: getInitialStageHeight(),
    floodHeight: BUCKET_HEIGHT,
  });
  const pointerRef = useRef({
    x: 0,
    y: 0,
    active: false,
  });

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    statusRef.current = game.status;
  }, [game.status]);

  useEffect(() => {
    showWipeCursorRef.current = showWipeCursor;
    syncWipeCursorElement(
      pointerRef.current.x,
      pointerRef.current.y,
      pointerRef.current.active,
    );
  }, [showWipeCursor]);

  useEffect(() => {
    const audio = new Audio(welcomeMusic);

    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 0.36;
    audio.load();
    welcomeMusicRef.current = audio;

    if (soundOnRef.current && statusRef.current === "idle") {
      startWelcomeMusic();
    }

    return () => {
      pendingWelcomeUnlockRef.current = false;
      audio.pause();
      welcomeMusicRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pool = Array.from({ length: 4 }, () => {
      const audio = new Audio(wipeDropSfx);

      audio.preload = "auto";
      audio.volume = 0.5;
      return audio;
    });

    wipeSfxRef.current = pool;

    return () => {
      pool.forEach((audio) => {
        audio.pause();
      });
      wipeSfxRef.current = [];
    };
  }, []);

  useEffect(() => {
    const pool = Array.from({ length: 3 }, () => {
      const audio = new Audio(missedCrySfx);

      audio.preload = "auto";
      audio.volume = 0.45;
      return audio;
    });

    missedCryRef.current = pool;

    return () => {
      pool.forEach((audio) => {
        audio.pause();
      });
      missedCryRef.current = [];
    };
  }, []);

  useEffect(() => {
    const audio = new Audio(gameOverSfx);

    audio.preload = "auto";
    audio.volume = 0.6;
    audio.load();
    gameOverSfxRef.current = audio;

    return () => {
      audio.pause();
      gameOverSfxRef.current = null;
    };
  }, []);

  useEffect(() => {
    function handleWelcomeUnlock() {
      if (
        !pendingWelcomeUnlockRef.current ||
        !soundOnRef.current ||
        statusRef.current !== "idle"
      ) {
        return;
      }

      getAudioNodes();
      startWelcomeMusic({ restart: true });
    }

    window.addEventListener("pointerdown", handleWelcomeUnlock, {
      passive: true,
    });
    window.addEventListener("keydown", handleWelcomeUnlock);

    return () => {
      window.removeEventListener("pointerdown", handleWelcomeUnlock);
      window.removeEventListener("keydown", handleWelcomeUnlock);
    };
  }, []);

  useEffect(() => {
    const welcomeTrack = welcomeMusicRef.current;

    if (!welcomeTrack) {
      return;
    }

    if (soundOn && game.status === "idle") {
      startWelcomeMusic();
      return;
    }

    pendingWelcomeUnlockRef.current = false;
    welcomeTrack.pause();
    welcomeTrack.currentTime = 0;
  }, [soundOn, game.status]);

  useEffect(() => {
    function measureStage() {
      const nextPerformanceMode = getPerformanceMode();

      setPerformanceMode(nextPerformanceMode);
      setShowWipeCursor(shouldShowWipeCursor(nextPerformanceMode));

      if (!stageRef.current) {
        return;
      }

      stageSizeRef.current = {
        width: stageRef.current.clientWidth,
        height: stageRef.current.clientHeight,
        floodHeight: floodSceneRef.current?.clientHeight ?? BUCKET_HEIGHT,
      };
    }

    measureStage();
    window.addEventListener("resize", measureStage);

    return () => {
      window.removeEventListener("resize", measureStage);
      window.cancelAnimationFrame(animationRef.current);
    };
  }, []);

  function syncWipeCursorElement(x, y, active) {
    if (!wipeCursorRef.current) {
      return;
    }

    wipeCursorRef.current.style.left = `${x}px`;
    wipeCursorRef.current.style.top = `${y}px`;
    wipeCursorRef.current.classList.toggle(
      "is-active",
      active && showWipeCursorRef.current,
    );
  }

  function getAudioNodes() {
    if (typeof window === "undefined") {
      return null;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      return null;
    }

    if (!audioContextRef.current) {
      const audioContext = new AudioContext();
      const masterGain = audioContext.createGain();

      masterGain.gain.value = 0.42;
      masterGain.connect(audioContext.destination);
      audioContextRef.current = audioContext;
      masterGainRef.current = masterGain;
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    return {
      audioContext: audioContextRef.current,
      masterGain: masterGainRef.current,
    };
  }

  function startWelcomeMusic({ restart = false } = {}) {
    const welcomeTrack = welcomeMusicRef.current;

    if (!welcomeTrack || !soundOnRef.current || statusRef.current !== "idle") {
      return;
    }

    if (restart) {
      welcomeTrack.currentTime = 0;
    }

    pendingWelcomeUnlockRef.current = false;
    welcomeTrack.play().catch((error) => {
      if (error?.name === "NotAllowedError") {
        pendingWelcomeUnlockRef.current = true;
      }
    });
  }

  function stopAudioInstance(audio) {
    if (!audio) {
      return;
    }

    audio.onended = null;
    audio.pause();
    audio.currentTime = 0;
  }

  function isAudioPlaying(audio) {
    return Boolean(audio && !audio.paused && !audio.ended);
  }

  function clearActiveEffect(audio) {
    if (activeEffectRef.current.audio === audio) {
      activeEffectRef.current = {
        kind: null,
        audio: null,
      };
    }
  }

  function stopAllEffectAudio() {
    [...(wipeSfxRef.current ?? []), ...(missedCryRef.current ?? [])].forEach(
      stopAudioInstance,
    );
    stopAudioInstance(gameOverSfxRef.current);
    activeEffectRef.current = {
      kind: null,
      audio: null,
    };
  }

  function finishEffectPlayback(audio) {
    clearActiveEffect(audio);
  }

  function beginEffectPlayback(kind, audio) {
    if (!audio) {
      return;
    }

    activeEffectRef.current = { kind, audio };
    audio.currentTime = 0;
    audio.onended = () => {
      finishEffectPlayback(audio);
    };
    audio.play().catch(() => {
      finishEffectPlayback(audio);
    });
  }

  function claimEffectChannel() {
    if (!soundOnRef.current) {
      return false;
    }

    const activeEffect = activeEffectRef.current.audio;

    if (isAudioPlaying(activeEffect)) {
      stopAudioInstance(activeEffect);
      clearActiveEffect(activeEffect);
    }

    return true;
  }

  function stopAllAudio() {
    pendingWelcomeUnlockRef.current = false;
    stopAudioInstance(welcomeMusicRef.current);
    stopAllEffectAudio();
  }

  function playTone({
    frequency,
    duration,
    type = "sine",
    volume = 0.12,
    bendTo = null,
  }) {
    if (!soundOnRef.current) {
      return;
    }

    const nodes = getAudioNodes();

    if (!nodes) {
      return;
    }

    const { audioContext, masterGain } = nodes;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);

    if (bendTo) {
      oscillator.frequency.exponentialRampToValueAtTime(bendTo, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.04);
  }

  function playNoise({ duration, volume = 0.08 }) {
    if (!soundOnRef.current) {
      return;
    }

    const nodes = getAudioNodes();

    if (!nodes) {
      return;
    }

    const { audioContext, masterGain } = nodes;
    const bufferSize = Math.max(
      1,
      Math.floor(audioContext.sampleRate * duration),
    );
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate,
    );
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < bufferSize; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize);
    }

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 1150;
    filter.Q.value = 1.4;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(now);
  }

  function playFromPool(kind, poolRef) {
    const pool = poolRef.current;

    if (!pool || pool.length === 0 || !claimEffectChannel()) {
      return;
    }

    const sound = pool[0];
    beginEffectPlayback(kind, sound);
  }

  function primeAudioOnUnlock(includeGameplay = false) {
    const allSounds = includeGameplay
      ? [
          wipeSfxRef.current?.[0],
          missedCryRef.current?.[0],
          gameOverSfxRef.current,
        ].filter(Boolean)
      : [welcomeMusicRef.current].filter(Boolean);

    allSounds.forEach((audio) => {
      const previousVolume = audio.volume;

      audio.volume = 0;
      audio.currentTime = 0;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = previousVolume;
        })
        .catch(() => {
          audio.volume = previousVolume;
        });
    });
  }

  function playWipeSound() {
    if (!soundOnRef.current) {
      return;
    }

    const pool = wipeSfxRef.current;

    if (!pool || pool.length === 0) {
      return;
    }

    pool.forEach(stopAudioInstance);
    pool[0].play().catch(() => {});
  }

  function playCrySound() {
    playFromPool("cry", missedCryRef);
  }

  function playGameOverSound({ interruptAll = false } = {}) {
    if (!gameOverSfxRef.current || !soundOnRef.current) {
      return;
    }

    if (interruptAll) {
      stopAllAudio();
    } else if (!claimEffectChannel()) {
      return;
    }

    beginEffectPlayback("gameover", gameOverSfxRef.current);
  }

  function enableSound({ restartWelcome = false } = {}) {
    soundOnRef.current = true;
    pendingWelcomeUnlockRef.current = false;
    setSoundOn(true);
    setShowSoundPrompt(false);
    getAudioNodes();

    if (statusRef.current === "idle") {
      startWelcomeMusic({ restart: restartWelcome });
      return;
    }

    primeAudioOnUnlock(true);

    if (statusRef.current === "gameover") {
      playGameOverSound({ interruptAll: true });
    }
  }

  function disableSound() {
    soundOnRef.current = false;
    setSoundOn(false);
    stopAllAudio();
  }

  function toggleSound() {
    if (soundOnRef.current) {
      disableSound();
      return;
    }

    enableSound({ restartWelcome: statusRef.current === "idle" });
  }

  const soundButton = (
    <button
      type="button"
      className={`sound-toggle ${soundOn ? "is-on" : ""}`}
      onClick={toggleSound}
      aria-pressed={soundOn}
      aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
      title={soundOn ? "Sound on" : "Sound off"}
    >
      <span className="sr-only">{soundOn ? "Sound on" : "Sound off"}</span>
      <svg
        className="sound-toggle-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          className="sound-toggle-speaker"
          d="M4 10v4h4.2L13 18V6L8.2 10H4Z"
        />
        <path
          className="sound-toggle-wave sound-toggle-wave-one"
          d="M16 9.4a4.3 4.3 0 0 1 0 5.2"
        />
        <path
          className="sound-toggle-wave sound-toggle-wave-two"
          d="M18.7 7.2a7.6 7.6 0 0 1 0 9.6"
        />
        <path className="sound-toggle-slash" d="M6 18 18 6" />
      </svg>
      <span className="sound-toggle-status" aria-hidden="true" />
    </button>
  );

  function endGame(finalElapsedMs, bucketDrops) {
    statusRef.current = "gameover";
    window.cancelAnimationFrame(animationRef.current);
    playGameOverSound({ interruptAll: true });

    setGame((current) => ({
      ...current,
      status: "gameover",
      elapsedMs: finalElapsedMs,
      totalTimeMs: finalElapsedMs,
      bucketDrops: Math.min(bucketDrops, BUCKET_LIMIT),
      feedback: "The tear flood swallowed the people. Game over.",
    }));
  }

  function frame(now) {
    if (statusRef.current !== "playing") {
      return;
    }

    const elapsedMs = now - runStartedAtRef.current;
    const deltaMs = lastFrameAtRef.current ? now - lastFrameAtRef.current : 16;
    const deltaSeconds = deltaMs / 1000;
    const spawnMs = getSpawnMs(elapsedMs);
    const stageWidth = stageSizeRef.current.width;
    const stageHeight = stageSizeRef.current.height;
    const floodHeight = stageSizeRef.current.floodHeight ?? BUCKET_HEIGHT;
    const bucketTop = stageHeight - BUCKET_BOTTOM_OFFSET - floodHeight;

    lastFrameAtRef.current = now;

    let wipedThisFrame = 0;
    let bucketHitsThisFrame = 0;

    let nextTears = tearsRef.current.map((tear) => ({
      ...tear,
      x: clamp(
        tear.x + tear.drift * deltaSeconds,
        tear.size * 0.6,
        stageWidth - tear.size * 0.6,
      ),
      y: tear.y + tear.speed * deltaSeconds,
    }));

    if (pointerRef.current.active) {
      nextTears = nextTears.filter((tear) => {
        const dx = tear.x - pointerRef.current.x;
        const dy = tear.y - pointerRef.current.y;
        const radius = WIPE_RADIUS + tear.size * 0.42;
        const isWiped = dx * dx + dy * dy <= radius * radius;

        if (isWiped) {
          wipedThisFrame += 1;
        }

        return !isWiped;
      });
    }

    nextTears = nextTears.filter((tear) => {
      const reachedBucket = tear.y >= bucketTop - tear.size * 0.35;

      if (reachedBucket) {
        bucketHitsThisFrame += 1;
      }

      return !reachedBucket;
    });

    if (wipedThisFrame > 0) {
      wipedTearsRef.current += wipedThisFrame;
      playWipeSound();
    }

    if (bucketHitsThisFrame > 0) {
      bucketDropsRef.current = Math.min(
        BUCKET_LIMIT,
        bucketDropsRef.current + bucketHitsThisFrame,
      );
      playCrySound();
    }

    while (now - lastSpawnAtRef.current >= spawnMs) {
      nextTears.push(...createSpawnBatch(stageWidth, elapsedMs, nextTearIdRef));
      lastSpawnAtRef.current += spawnMs;
    }

    tearsRef.current = nextTears;
    setTears(nextTears);

    if (bucketDropsRef.current >= BUCKET_LIMIT) {
      endGame(elapsedMs, bucketDropsRef.current);
      return;
    }

    const displayElapsedMs = Math.floor(elapsedMs / 100) * 100;
    const nextFeedback =
      bucketHitsThisFrame > 0
        ? `A tear joined the flood. ${BUCKET_LIMIT - bucketDropsRef.current} slot${BUCKET_LIMIT - bucketDropsRef.current === 1 ? "" : "s"} left.`
        : wipedThisFrame > 0
          ? "Nice wipe. Keep clearing the flow before the flood rises."
          : null;

    setGame((current) => {
      if (
        current.elapsedMs === displayElapsedMs &&
        current.bucketDrops === bucketDropsRef.current &&
        current.wipedTears === wipedTearsRef.current &&
        !nextFeedback
      ) {
        return current;
      }

      return {
        ...current,
        elapsedMs: displayElapsedMs,
        bucketDrops: bucketDropsRef.current,
        wipedTears: wipedTearsRef.current,
        feedback: nextFeedback ?? current.feedback,
      };
    });

    animationRef.current = window.requestAnimationFrame(frame);
  }

  function startGame() {
    stopAllAudio();

    if (soundOnRef.current) {
      getAudioNodes();
      primeAudioOnUnlock(true);
    }

    if (stageRef.current) {
      stageSizeRef.current = {
        width: stageRef.current.clientWidth,
        height: stageRef.current.clientHeight,
        floodHeight: floodSceneRef.current?.clientHeight ?? BUCKET_HEIGHT,
      };
    }

    const now = performance.now();

    window.cancelAnimationFrame(animationRef.current);

    runStartedAtRef.current = now;
    lastFrameAtRef.current = now;
    lastSpawnAtRef.current = now - 350;
    nextTearIdRef.current = 1;
    tearsRef.current = [];
    bucketDropsRef.current = 0;
    wipedTearsRef.current = 0;
    statusRef.current = "playing";
    pointerRef.current = {
      x: 0,
      y: 0,
      active: false,
    };
    syncWipeCursorElement(0, 0, false);
    setTears([]);
    setGame({
      status: "playing",
      elapsedMs: 0,
      totalTimeMs: 0,
      bucketDrops: 0,
      wipedTears: 0,
      spawnMs: getSpawnMs(0),
      fallSpeed: getFallSpeed(0),
      feedback:
        "Sen. P’s tears are falling fast! Grab the Kumusta Handkerchief and wipe them away before the drama turns into a flood and our kababayan start swimming for survival.",
    });

    animationRef.current = window.requestAnimationFrame(frame);
  }

  function syncPointerPosition(clientX, clientY, active = true) {
    if (!stageRef.current) {
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    pointerRef.current = {
      x,
      y,
      active,
    };
    syncWipeCursorElement(x, y, active);
  }

  function handlePointerDown(event) {
    if (event.pointerType !== "mouse") {
      event.preventDefault();
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    syncPointerPosition(event.clientX, event.clientY, true);
  }

  function handlePointerMove(event) {
    if (event.pointerType !== "mouse") {
      event.preventDefault();
    }

    syncPointerPosition(event.clientX, event.clientY, true);
  }

  function handlePointerEnd(event) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    pointerRef.current = {
      ...pointerRef.current,
      active: false,
    };
    syncWipeCursorElement(
      pointerRef.current.x,
      pointerRef.current.y,
      false,
    );
  }

  const liveTotalMs =
    game.status === "gameover" ? game.totalTimeMs : game.elapsedMs;
  const bucketRatio =
    (Math.min(game.bucketDrops, BUCKET_LIMIT) / BUCKET_LIMIT) * 100;
  const currentMood = getCharacterMood(game.status, game.bucketDrops);
  const showDistressedFace = game.bucketDrops >= 3;
  const portraitSource = showDistressedFace
    ? distressedCharacter
    : cryingCharacter;
  const speech =
    game.bucketDrops > 0
      ? CHARACTER_DIALOGUE[
          Math.min(game.bucketDrops - 1, CHARACTER_DIALOGUE.length - 1)
        ]
      : "We are under attack!";

  if (game.status === "idle") {
    return (
      <main className={`intro-shell ${performanceMode ? "performance-mode" : ""}`}>
        {soundButton}
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <section className="intro-panel">
          <div className="intro-copy">
            <h1 className="intro-title">
              SENA
              <span
                style={{
                  color: "#38bdf8",
                  textShadow: `
        0 0 8px rgba(56, 189, 248, 0.9),
        0 0 18px rgba(14, 165, 233, 0.8),
        0 0 28px rgba(2, 132, 199, 0.7)
      `,
                }}
              >
                TEARS
              </span>
            </h1>
            <p className="eyebrow">How To Play</p>
            <p className="intro-lead" style={{ marginTop: -25 }}>
              Sen. P’s tears are falling fast! Grab the Kumusta Handkerchief and
              wipe them away before the drama turns into a flood and our
              kababayan start swimming for survival.
            </p>

            <div className="intro-rules">
              <p>Wipe the tears before they splash the people below.</p>
              <p>
                Each missed tear adds to the flood. At 8 / 8, everyone is
                drowned.
              </p>
              <p>
                Wipe fast! The longer you survive, the faster the tears fall.
              </p>
            </div>

            <button
              type="button"
              className="start-button intro-button"
              onClick={startGame}
            >
              <span>PLAY</span>
            </button>
          </div>

          <div className="intro-visual">
            <div className="intro-portrait-card">
              <img
                className="character-image intro-character-image"
                src={cryingCharacter}
                alt="Pixel-art crying character"
              />
            </div>
          </div>
        </section>

        {showSoundPrompt ? (
          <div className="sound-prompt-backdrop">
            <section
              className="sound-prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sound-prompt-title"
            >
              <p className="sound-prompt-kicker">Audio Recommendation</p>
              <h2 id="sound-prompt-title" className="sound-prompt-title">
                Better with sound
              </h2>
              <p className="sound-prompt-copy">
                Turn the music on for the full drama.
              </p>
              <div className="sound-prompt-actions">
                <button
                  type="button"
                  className="sound-prompt-button sound-prompt-button-primary"
                  onClick={() => enableSound({ restartWelcome: true })}
                >
                  Turn it on
                </button>
                <button
                  type="button"
                  className="sound-prompt-button sound-prompt-button-secondary"
                  onClick={() => setShowSoundPrompt(false)}
                >
                  Cancel
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    );
  }

  if (game.status === "gameover") {
    return (
      <main
        className={`gameover-shell ${performanceMode ? "performance-mode" : ""}`}
      >
        {soundButton}
        <div className="gameover-glow gameover-glow-one" />
        <div className="gameover-glow gameover-glow-two" />

        <section className="gameover-panel">
          <p className="gameover-kicker">Thank you for playing!</p>
          <h1 className="gameover-title">Game Over</h1>
          <p className="gameover-copy">Hindi n'yo kasi kinumusta!</p>

          <div className="gameover-portrait-wrap">
            <div className="gameover-portrait-frame">
              <img
                className="gameover-portrait"
                src={gameOverCharacter}
                alt="Pixel-art crying character in a dramatic game-over portrait"
              />
            </div>
          </div>

          <button type="button" className="gameover-button" onClick={startGame}>
            <span>PLAY AGAIN</span>
          </button>

          <div className="gameover-stats">
            <article className="gameover-stat">
              <span className="gameover-stat-label">Total Drops Wiped</span>
              <strong className="gameover-stat-value">{game.wipedTears}</strong>
            </article>
            <article className="gameover-stat">
              <span className="gameover-stat-label">Time Survived</span>
              <strong className="gameover-stat-value">
                {formatTime(game.totalTimeMs)}
              </strong>
            </article>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${performanceMode ? "performance-mode" : ""}`}>
      {soundButton}
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="layout-shell game-layout-shell">
        <div className="layout-grid game-layout-grid">
          <GameSidebar
            currentMood={currentMood}
            speech={speech}
            portraitSource={portraitSource}
            showDistressedFace={showDistressedFace}
          />

          <section className="stage-panel game-stage-panel">
            <div className="stage-frame game-stage-frame">
              <div
                ref={stageRef}
                className="tear-stage"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerLeave={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
              >
                <div className="stage-hud">
                  <span className="stage-chip">
                    Tears {Math.min(game.bucketDrops, BUCKET_LIMIT)} /{" "}
                    {BUCKET_LIMIT}
                  </span>
                  <span className="stage-chip">
                    Survival {formatTime(liveTotalMs)}
                  </span>
                </div>

                {tears.map((tear) => (
                  <div
                    key={tear.id}
                    className="tear-drop"
                    aria-hidden="true"
                    style={{
                      left: `${tear.x}px`,
                      top: `${tear.y}px`,
                      width: `${tear.size}px`,
                      height: `${tear.size * 1.3}px`,
                    }}
                  >
                    <img
                      className="tear-drop-image"
                      src={tearDropImage}
                      alt=""
                    />
                  </div>
                ))}

                {showWipeCursor ? (
                  <div ref={wipeCursorRef} className="wipe-cursor" aria-hidden="true">
                    <img
                      className="wipe-cursor-image"
                      src={handkerchiefCursor}
                      alt=""
                    />
                  </div>
                ) : null}

                <div className="bucket-wrap" aria-hidden="true">
                  <div ref={floodSceneRef} className="flood-scene">
                    <img
                      className="flood-crowd-image"
                      src={floodCrowd}
                      alt=""
                    />
                    <div
                      className="bucket-fill flood-water"
                      style={{
                        height: game.bucketDrops > 0 ? `${bucketRatio}%` : 0,
                      }}
                    >
                      <span className="flood-wave wave-one" />
                      <span className="flood-wave wave-two" />
                      <span className="flood-wave wave-three" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
