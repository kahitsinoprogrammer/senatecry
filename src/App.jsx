import { useEffect, useRef, useState } from 'react';
import cryingCharacter from './assets/crying-character.png';
import distressedCharacter from './assets/crying-character-distressed.png';
import gameOverCharacter from './assets/crying-character-gameover.png';
import floodCrowd from './assets/flood-crowd.png';
import handkerchiefCursor from './assets/handkerchief-kumusta-ka.png';

const BUCKET_LIMIT = 8;
const BUCKET_HEIGHT = 176;
const BUCKET_BOTTOM_OFFSET = 0;
const WIPE_RADIUS = 34;
const TEAR_SOURCES = [0.12, 0.26, 0.4, 0.6, 0.74, 0.88];
const CHARACTER_DIALOGUE = [
  'Takot na takot po ako!',
  'Napakarami nang nangyare!',
  'Wala ho akong sinisisi!',
  'Walang ni isa sa inyong nangumusta sa amin',
  'HUHUHU...',
  'Some of you I know for 20 years',
  "I didn't hear any of you!",
];

const initialGame = {
  status: 'idle',
  elapsedMs: 0,
  totalTimeMs: 0,
  bucketDrops: 0,
  wipedTears: 0,
  spawnMs: 900,
  fallSpeed: 220,
  feedback: 'Hover over the falling tears before they turn the bottom of the stage into a flood.',
};

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getSpawnMs(elapsedMs) {
  return Math.max(320, 920 - elapsedMs / 120);
}

function getFallSpeed(elapsedMs) {
  return 220 + elapsedMs / 140;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createTear(id, stageWidth, elapsedMs, source = null, laneOffset = 0) {
  const sourceRatio = source ?? TEAR_SOURCES[Math.floor(Math.random() * TEAR_SOURCES.length)];
  const size = randomBetween(18, 28);
  const x = clamp(
    stageWidth * sourceRatio + laneOffset * 18 + randomBetween(-stageWidth * 0.04, stageWidth * 0.04),
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
  const startIndex = Math.floor(Math.random() * (TEAR_SOURCES.length - count + 1));

  return TEAR_SOURCES.slice(startIndex, startIndex + count).map((source, index) => {
    const tear = createTear(
      nextTearIdRef.current,
      stageWidth,
      elapsedMs,
      source,
      index - (count - 1) / 2,
    );

    nextTearIdRef.current += 1;
    return tear;
  });
}

function getCharacterMood(status, bucketDrops) {
  if (status === 'gameover') {
    return 'gameover';
  }

  if (bucketDrops >= 5) {
    return 'warning';
  }

  return 'crying';
}

export default function App() {
  const [game, setGame] = useState(initialGame);
  const [tears, setTears] = useState([]);
  const [wipeCursor, setWipeCursor] = useState({
    x: 0,
    y: 0,
    active: false,
  });

  const stageRef = useRef(null);
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
    width: 560,
    height: 420,
  });
  const mouseRef = useRef({
    x: 0,
    y: 0,
    active: false,
  });

  useEffect(() => {
    function measureStage() {
      if (!stageRef.current) {
        return;
      }

      stageSizeRef.current = {
        width: stageRef.current.clientWidth,
        height: stageRef.current.clientHeight,
      };
    }

    measureStage();
    window.addEventListener('resize', measureStage);

    return () => {
      window.removeEventListener('resize', measureStage);
      window.cancelAnimationFrame(animationRef.current);
    };
  }, []);

  function endGame(finalElapsedMs, bucketDrops) {
    statusRef.current = 'gameover';
    window.cancelAnimationFrame(animationRef.current);

    setGame((current) => ({
      ...current,
      status: 'gameover',
      elapsedMs: finalElapsedMs,
      totalTimeMs: finalElapsedMs,
      bucketDrops: Math.min(bucketDrops, BUCKET_LIMIT),
      feedback: 'The tear flood swallowed the people. Game over.',
    }));
  }

  function frame(now) {
    if (statusRef.current !== 'playing') {
      return;
    }

    const elapsedMs = now - runStartedAtRef.current;
    const deltaMs = lastFrameAtRef.current ? now - lastFrameAtRef.current : 16;
    const deltaSeconds = deltaMs / 1000;
    const spawnMs = getSpawnMs(elapsedMs);
    const fallSpeed = getFallSpeed(elapsedMs);
    const stageWidth = stageSizeRef.current.width;
    const stageHeight = stageSizeRef.current.height;
    const bucketTop = stageHeight - BUCKET_BOTTOM_OFFSET - BUCKET_HEIGHT + 10;

    lastFrameAtRef.current = now;

    let wipedThisFrame = 0;
    let bucketHitsThisFrame = 0;

    let nextTears = tearsRef.current.map((tear) => ({
      ...tear,
      x: clamp(tear.x + tear.drift * deltaSeconds, tear.size * 0.6, stageWidth - tear.size * 0.6),
      y: tear.y + tear.speed * deltaSeconds,
    }));

    if (mouseRef.current.active) {
      nextTears = nextTears.filter((tear) => {
        const dx = tear.x - mouseRef.current.x;
        const dy = tear.y - mouseRef.current.y;
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
    }

    if (bucketHitsThisFrame > 0) {
      bucketDropsRef.current = Math.min(BUCKET_LIMIT, bucketDropsRef.current + bucketHitsThisFrame);
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

    setGame((current) => ({
      ...current,
      elapsedMs,
      bucketDrops: bucketDropsRef.current,
      wipedTears: wipedTearsRef.current,
      spawnMs,
      fallSpeed,
      feedback:
        bucketHitsThisFrame > 0
          ? `A tear joined the flood. ${BUCKET_LIMIT - bucketDropsRef.current} slot${BUCKET_LIMIT - bucketDropsRef.current === 1 ? '' : 's'} left.`
          : wipedThisFrame > 0
            ? 'Nice wipe. Keep clearing the flow before the flood rises.'
            : current.feedback,
    }));

    animationRef.current = window.requestAnimationFrame(frame);
  }

  function startGame() {
    if (stageRef.current) {
      stageSizeRef.current = {
        width: stageRef.current.clientWidth,
        height: stageRef.current.clientHeight,
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
    statusRef.current = 'playing';
    mouseRef.current = {
      x: 0,
      y: 0,
      active: false,
    };

    setWipeCursor({
      x: 0,
      y: 0,
      active: false,
    });
    setTears([]);
    setGame({
      status: 'playing',
      elapsedMs: 0,
      totalTimeMs: 0,
      bucketDrops: 0,
      wipedTears: 0,
      spawnMs: getSpawnMs(0),
      fallSpeed: getFallSpeed(0),
      feedback: 'Hover over each falling tear before it reaches the flood line. Some waves drop in parallel.',
    });

    animationRef.current = window.requestAnimationFrame(frame);
  }

  function handleMouseMove(event) {
    if (!stageRef.current) {
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    mouseRef.current = {
      x,
      y,
      active: true,
    };

    setWipeCursor({
      x,
      y,
      active: true,
    });
  }

  function handleMouseLeave() {
    mouseRef.current = {
      ...mouseRef.current,
      active: false,
    };

    setWipeCursor((current) => ({
      ...current,
      active: false,
    }));
  }

  const liveTotalMs = game.status === 'gameover' ? game.totalTimeMs : game.elapsedMs;
  const bucketRatio = (Math.min(game.bucketDrops, BUCKET_LIMIT) / BUCKET_LIMIT) * 100;
  const currentMood = getCharacterMood(game.status, game.bucketDrops);
  const showDistressedFace = game.bucketDrops >= 3;
  const portraitSource = showDistressedFace ? distressedCharacter : cryingCharacter;
  const speech =
    game.bucketDrops > 0
      ? CHARACTER_DIALOGUE[Math.min(game.bucketDrops - 1, CHARACTER_DIALOGUE.length - 1)]
      : 'Wipe the tears before they drop!';

  if (game.status === 'gameover') {
    return (
      <main className="gameover-shell">
        <div className="gameover-glow gameover-glow-one" />
        <div className="gameover-glow gameover-glow-two" />

        <section className="gameover-panel">
          <p className="gameover-kicker">Tear Flood Alert</p>
          <h1 className="gameover-title">Game Over</h1>
          <p className="gameover-copy">
            The flood got away from you. Reset the wipe and try to save the crowd again.
          </p>

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
              <strong className="gameover-stat-value">{formatTime(game.totalTimeMs)}</strong>
            </article>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="layout-shell">


        <div className="layout-grid">
          <aside className={`sidebar-panel mood-${currentMood}`}>
            <div className="speech-bubble">{speech}</div>

            <div className={`portrait-card ${showDistressedFace ? 'is-distressed' : ''}`}>
              <img
                className="character-image"
                src={portraitSource}
                alt="Pixel-art crying character"
              />
            </div>

            <button type="button" className="start-button" onClick={startGame}>
              <span>
                {game.status === 'playing'
                  ? 'ON GAME'
                  : game.status === 'gameover'
                    ? 'PLAY AGAIN'
                    : 'PLAY'}
              </span>
            </button>

            <div className="status-grid">
              <article className="stat-box">
                <span className="stat-label">Wiped</span>
                <strong className="stat-value">{game.wipedTears}</strong>
              </article>
              <article className="stat-box">
                <span className="stat-label">Flood</span>
                <strong className="stat-value">
                  {Math.min(game.bucketDrops, BUCKET_LIMIT)} / {BUCKET_LIMIT}
                </strong>
              </article>
              <article className="stat-box">
                <span className="stat-label">Survival</span>
                <strong className="stat-value">{formatTime(liveTotalMs)}</strong>
              </article>
            </div>

            <p className="feedback-card">{game.feedback}</p>
          </aside>

          <section className="stage-panel">
            <div className="stage-topline">
              <span className="stage-chip">
                Mood:{' '}
                {currentMood === 'warning'
                  ? 'Flooding'
                  : currentMood === 'gameover'
                    ? 'Overflow'
                    : 'Crying'}
              </span>
              <span className="stage-chip">Flow {Math.round(game.fallSpeed)} px/s</span>
            </div>

            <div className="stage-frame">
              <div
                ref={stageRef}
                className="tear-stage"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                <div className="tear-stream-guide" aria-hidden="true" />
                <div className="tear-stream-guide guide-two" aria-hidden="true" />
                <div className="tear-stream-guide guide-three" aria-hidden="true" />
                <div className="tear-stream-guide guide-four" aria-hidden="true" />

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
                  />
                ))}

                {wipeCursor.active ? (
                  <div
                    className="wipe-cursor"
                    aria-hidden="true"
                    style={{
                      left: `${wipeCursor.x}px`,
                      top: `${wipeCursor.y}px`,
                    }}
                  >
                    <img className="wipe-cursor-image" src={handkerchiefCursor} alt="" />
                  </div>
                ) : null}

                <div className="bucket-wrap" aria-hidden="true">
                  <div className="flood-scene">
                    <img className="flood-crowd-image" src={floodCrowd} alt="" />
                    <div className="bucket-fill flood-water" style={{ height: `${bucketRatio}%` }}>
                     
                    </div>
                  </div>
                </div>
              </div>

              <div className="stage-bottomline">
                <span className="bucket-note">
                  Flood {Math.min(game.bucketDrops, BUCKET_LIMIT)} / {BUCKET_LIMIT}
                </span>
                <span className="bucket-note">Spawn {(game.spawnMs / 1_000).toFixed(2)}s</span>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
