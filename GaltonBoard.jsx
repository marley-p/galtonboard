import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/**
 * Interactive Galton (Quincunx) Board — No Tailwind Required
 * ----------------------------------------------------------
 * - Pure React + inline CSS styles (no Tailwind).
 * - Canvas animation for the board on the left.
 * - Fixed-width controls + histogram sidebar on the right.
 */

// ---------- simple style helpers (no external CSS) ----------
const styles = {
  page: {
    width: "100%",
    maxWidth: 1100,
    margin: "0 auto",
    padding: 16,
    boxSizing: "border-box",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans, 'Apple Color Emoji', 'Segoe UI Emoji'",
    color: "#0f172a", // slate-900-ish
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 320px", // left flexible, right fixed
    gap: 24,
    alignItems: "start",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 6px 20px rgba(2, 6, 23, 0.08)",
    padding: 16,
  },
  h2: { fontSize: 20, fontWeight: 600, margin: 0 },
  sub: { fontSize: 13, color: "#64748b" }, // slate-500
  borderBox: {
    position: "relative",
    width: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
    background: "#f8fafc",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  btnRow: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 },
  btnPrimary: {
    padding: "8px 14px",
    borderRadius: 14,
    border: 0,
    background: "#0284c7",
    color: "white",
    cursor: "pointer",
  },
  btnDark: {
    padding: "8px 14px",
    borderRadius: 14,
    border: 0,
    background: "#111827",
    color: "white",
    cursor: "pointer",
  },
  btnLight: {
    padding: "8px 14px",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "#f1f5f9",
    color: "#0f172a",
    cursor: "pointer",
  },
  sidebar: { width: 320 },
  ctlGridRow: {
    display: "grid",
    gridTemplateColumns: "150px 1fr",
    gap: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  label: { fontSize: 13, color: "#475569" },
  numberInput: { width: 110, padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 8 },
};

// clamp helper
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// deterministic RNG
function mulberry32(seed) {
  let a = seed || Math.floor(Math.random() * 2 ** 31);
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ball model
class Ball {
  constructor({ x0, y0, col0, rows, spacing, stepMs, bias, rng }) {
    this.x = x0;
    this.y = y0;
    this.col = col0;
    this.row = 0;
    this.rows = rows;
    this.spacing = spacing;
    this.stepMs = Math.max(40, stepMs);
    this.bias = bias;
    this.rng = rng || Math.random;
    this.done = false;
    this.t0 = performance.now();
    this.tx = x0;
    this.ty = y0 + spacing;
  }

  planNextTarget(boardCenterX) {
    if (this.row >= this.rows) {
      this.done = true;
      return;
    }
    const pRight = clamp(0.5 + this.bias, 0, 1);
    const goRight = this.rng() < pRight ? 1 : -1;
    this.col += goRight;
    this.row += 1;
    this.t0 = performance.now();
    this.ty += this.spacing;
    this.tx += goRight * (this.spacing / 2);

    const maxOffset = (this.rows * this.spacing) / 2;
    this.tx = clamp(this.tx, boardCenterX - maxOffset, boardCenterX + maxOffset);
  }

  update(now) {
    if (this.done) return;
    const u = clamp((now - this.t0) / this.stepMs, 0, 1);
    const ease = u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u; // quad easeInOut
    this.x = this.x + (this.tx - this.x) * ease;
    this.y = this.y + (this.ty - this.y) * ease;
    if (u >= 1 && this.row >= this.rows) this.done = true;
  }
}

export default function GaltonBoard() {
  // Controls
  const [rows, setRows] = useState(12);
  const [ballsPerBatch, setBallsPerBatch] = useState(50);
  const [bias, setBias] = useState(0);
  const [stepMs, setStepMs] = useState(140);
  const [scale, setScale] = useState(1);
  const [running, setRunning] = useState(false);
  const [seed, setSeed] = useState(12345);

  // Geometry
  const baseWidth = 520;
  const baseHeight = 700;
  const spacing = useMemo(() => 28 * scale, [scale]);
  const pegRadius = Math.max(2, 3 * scale);
  const ballRadius = Math.max(2, 3.2 * scale);

  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const ballsRef = useRef([]);
  const rngRef = useRef(mulberry32(seed));
  useEffect(() => {
    rngRef.current = mulberry32(seed);
  }, [seed]);

  const width = Math.round(baseWidth * scale);
  const height = Math.round(baseHeight * scale);

  const boardCenterX = width / 2;
  const topMargin = 40 * scale;
  const bottomMargin = 160 * scale;
  const boardTop = topMargin + 20 * scale;
  const boardBottom = height - bottomMargin;

  const pegRows = useMemo(() => {
    const rowsArr = [];
    for (let r = 0; r < rows; r++) {
      const y = boardTop + r * spacing;
      const count = r + 1;
      const rowWidth = (count - 1) * spacing;
      const startX = boardCenterX - rowWidth / 2;
      const pegs = Array.from({ length: count }, (_, i) => ({
        x: startX + i * spacing,
        y,
      }));
      rowsArr.push(pegs);
    }
    return rowsArr;
  }, [rows, spacing, boardCenterX, boardTop]);

  const binCount = rows + 1;
  const binCenters = useMemo(() => {
    const centers = [];
    const rowWidth = rows * spacing;
    const startX = boardCenterX - rowWidth / 2;
    for (let i = 0; i < binCount; i++) centers.push(startX + i * spacing);
    return centers;
  }, [rows, spacing, boardCenterX, binCount]);

  const [binTallies, setBinTallies] = useState(() => Array(binCount).fill(0));
  useEffect(() => setBinTallies(Array(binCount).fill(0)), [binCount]);
  const totalBalls = binTallies.reduce((a, b) => a + b, 0);

  // Ball launchers
  const launchBall = () => {
    const x0 = boardCenterX;
    const y0 = boardTop - spacing * 0.6;
    const col0 = 0;
    ballsRef.current.push(
      new Ball({
        x0,
        y0,
        col0,
        rows,
        spacing,
        stepMs,
        bias,
        rng: rngRef.current,
      })
    );
  };

  const launchBatch = (n) => {
    for (let i = 0; i < n; i++) {
      setTimeout(launchBall, i * Math.max(8, stepMs * 0.04));
    }
  };

  const reset = () => {
    ballsRef.current = [];
    setBinTallies(Array(binCount).fill(0));
  };

  // Animation loop
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const drawPegs = () => {
      ctx.fillStyle = "#94a3b8"; // slate-ish
      pegRows.forEach((row) => {
        row.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, pegRadius, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    };

    const drawBins = () => {
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1 * scale;
      const top = boardBottom;
      const base = height - 20 * scale;

      ctx.beginPath();
      // Side walls
      ctx.moveTo(boardCenterX - (rows * spacing) / 2 - spacing / 2, top);
      ctx.lineTo(boardCenterX - (rows * spacing) / 2 - spacing / 2, base);
      ctx.moveTo(boardCenterX + (rows * spacing) / 2 + spacing / 2, top);
      ctx.lineTo(boardCenterX + (rows * spacing) / 2 + spacing / 2, base);
      // Dividers
      for (let i = 0; i < binCount; i++) {
        const x = binCenters[i];
        ctx.moveTo(x, top);
        ctx.lineTo(x, base);
      }
      ctx.stroke();

      // Labels
      ctx.fillStyle = "#334155";
      ctx.font = `${12 * scale}px ui-sans-serif, system-ui, -apple-system`;
      for (let i = 0; i < binCount; i++) {
        const x = binCenters[i];
        const pct = totalBalls ? ((binTallies[i] / totalBalls) * 100).toFixed(1) : "0.0";
        const label = `${binTallies[i]} (${pct}%)`;
        ctx.textAlign = "center";
        ctx.fillText(label, x, base + 14 * scale);
      }
    };

    const drawBalls = () => {
      ctx.fillStyle = "#0ea5e9"; // sky-ish
      ballsRef.current.forEach((b) => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, ballRadius, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const tick = (now) => {
      ctx.clearRect(0, 0, width, height);

      // advance balls
      ballsRef.current.forEach((b) => {
        if (!b.done && (now - b.t0) / b.stepMs >= 1) {
          b.planNextTarget(width / 2);
        }
        b.update(now);
      });

      // collect done balls
      const stillFalling = [];
      ballsRef.current.forEach((b) => {
        if (b.done) {
          const idx = clamp(Math.round((b.col + rows) / 2), 0, rows);
          if (!Number.isNaN(idx)) {
            setBinTallies((prev) => {
              const next = prev.slice();
              next[idx] += 1;
              return next;
            });
          }
        } else {
          stillFalling.push(b);
        }
      });
      ballsRef.current = stillFalling;

      drawPegs();
      drawBins();
      drawBalls();

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    width,
    height,
    pegRows,
    spacing,
    rows,
    binCount,
    boardBottom,
    binCenters,
    ballRadius,
    totalBalls,
    scale,
  ]);

  // Auto-run batches when running = true
  useEffect(() => {
    let handle;
    if (running) {
      launchBatch(ballsPerBatch);
      handle = setInterval(
        () => launchBatch(ballsPerBatch),
        Math.max(500, stepMs * (rows + 2))
      );
    }
    return () => handle && clearInterval(handle);
  }, [running, ballsPerBatch, stepMs, rows]);

  // Histogram data
  const histData = useMemo(
    () => binTallies.map((v, i) => ({ bin: `${i}`, count: v })),
    [binTallies]
  );

  const expectedMean = (0.5 + bias) * rows;
  const expectedVar = rows * (0.5 + bias) * (0.5 - bias);
  const expectedSd = Math.sqrt(Math.max(0, expectedVar));

  return (
    <div style={styles.page}>
      <div style={styles.grid}>
        {/* Board */}
        <div style={styles.card}>
          <div style={styles.row}>
            <h2 style={styles.h2}>Interactive Galton Board</h2>
            <div style={styles.sub}>Rows: {rows} • Balls tallied: {totalBalls}</div>
          </div>
          <div style={styles.borderBox}>
            <canvas ref={canvasRef} width={width} height={height} style={{ width: "100%", height: "auto", display: "block" }} />
          </div>
          <div style={styles.btnRow}>
            <button onClick={() => setRunning((r) => !r)} style={styles.btnPrimary}>
              {running ? "Stop" : "Start"}
            </button>
            <button onClick={() => launchBatch(ballsPerBatch)} style={styles.btnDark}>
              Drop {ballsPerBatch}
            </button>
            <button onClick={reset} style={styles.btnLight}>
              Reset
            </button>
          </div>
        </div>

        {/* Controls + Histogram */}
        <div style={{ ...styles.card, ...styles.sidebar }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>Controls</h3>

          <div>
            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Rows: {rows}</div>
              <input type="range" min={5} max={20} value={rows} onChange={(e) => setRows(parseInt(e.target.value))} />
            </div>

            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Balls per batch: {ballsPerBatch}</div>
              <input type="range" min={1} max={200} value={ballsPerBatch} onChange={(e) => setBallsPerBatch(parseInt(e.target.value))} />
            </div>

            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Bias (right tilt): {(bias >= 0 ? "+" : "") + bias.toFixed(2)}</div>
              <input type="range" step={0.01} min={-0.25} max={0.25} value={bias} onChange={(e) => setBias(parseFloat(e.target.value))} />
            </div>

            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Speed (ms per step): {stepMs}</div>
              <input type="range" min={60} max={500} value={stepMs} onChange={(e) => setStepMs(parseInt(e.target.value))} />
            </div>

            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Size / Scale: {scale.toFixed(2)}</div>
              <input type="range" step={0.05} min={0.7} max={1.6} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} />
            </div>

            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Random Seed: {seed}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value || 0))} style={styles.numberInput} />
                <button style={styles.btnLight} onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>Randomize</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontWeight: 600 }}>Live Histogram</h4>
              <div style={{ fontSize: 12, color: "#64748b" }}>E[X] ≈ {expectedMean.toFixed(2)}, SD ≈ {expectedSd.toFixed(2)}</div>
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="bin" tick={{ fontSize: 12 }} label={{ value: "Bin", position: "insideBottom", offset: -5 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ marginTop: 16, fontSize: 13, color: "#475569" }}>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              Tip: With zero bias, the distribution approaches a binomial/normal curve centered at {rows / 2} as more balls drop.
            </p>
            <p style={{ margin: 0 }}>
              This simulation uses a discrete left/right step model with eased animation, matching the classic quincunx logic while staying performant.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
