import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ---------- simple style helpers (no external CSS) ----------
const styles = {
  page: { width: "100%", maxWidth: 1100, margin: "0 auto", padding: 16, boxSizing: "border-box", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans", color: "#0f172a" },
  grid: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 24, alignItems: "start" },
  card: { background: "#fff", borderRadius: 16, boxShadow: "0 6px 20px rgba(2, 6, 23, 0.08)", padding: 16 },
  h2: { fontSize: 20, fontWeight: 600, margin: 0 },
  sub: { fontSize: 13, color: "#64748b" },
  borderBox: { position: "relative", width: "100%", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", background: "#f8fafc" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  btnRow: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  btnPrimary: { padding: "8px 14px", borderRadius: 14, border: 0, background: "#0284c7", color: "white", cursor: "pointer" },
  btnDark: { padding: "8px 14px", borderRadius: 14, border: 0, background: "#111827", color: "white", cursor: "pointer" },
  btnLight: { padding: "8px 14px", borderRadius: 14, border: "1px solid #e2e8f0", background: "#f1f5f9", color: "#0f172a", cursor: "pointer" },
  sidebar: { width: 320 },
  ctlGridRow: { display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "center", marginBottom: 12 },
  label: { fontSize: 13, color: "#475569" }
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

// Probabilistic ball with physics-like bounce + horizontal tween at rows
class QBall {
  constructor({ x0, y0, r, rows, spacing, pRight, rng, rowYs }) {
    this.x = x0; this.y = y0; this.vx = 0; this.vy = 0; this.r = r;
    this.rows = rows; this.spacing = spacing; this.pRight = pRight; this.rng = rng;
    this.row = 0; this.rights = 0; this.rowYs = rowYs; this.done = false;
    this.txActive = false; this.txStart = 0; this.txTarget = 0; this.txT0 = 0; this.txDur = 0.14;
  }
}

export default function GaltonBoard() {
  const [rows, setRows] = useState(12);
  const [dropIntervalMs, setDropIntervalMs] = useState(500);
  const [bias, setBias] = useState(0);
  const [running, setRunning] = useState(false);

  // Geometry
  const baseWidth = 520, baseHeight = 700;
  const spacing = 28; // fixed spacing
  const pegRadius = 3;
  const ballRadius = 3.2;

  const canvasRef = useRef(null);
  const ballsRef = useRef([]);
  const rngRef = useRef(mulberry32(12345)); // fixed seed

  const width = baseWidth, height = baseHeight;
  const boardCenterX = width / 2;
  const topMargin = 40, bottomMargin = 160;
  const boardTop = topMargin + 20, boardBottom = height - bottomMargin;

  const pRight = clamp(0.5 + bias, 0, 1);

  const pegRows = useMemo(() => {
    const rowsArr = [];
    for (let r = 0; r < rows; r++) {
      const y = boardTop + r * spacing;
      const count = r + 1; const rowWidth = (count - 1) * spacing; const startX = boardCenterX - rowWidth / 2;
      const pegs = Array.from({ length: count }, (_, i) => ({ x: startX + i * spacing, y }));
      rowsArr.push(pegs);
    }
    return rowsArr;
  }, [rows, spacing, boardTop, boardCenterX]);

  const rowYs = useMemo(() => pegRows.map(r => r[0]?.y ?? boardTop), [pegRows, boardTop]);

  const binCount = rows + 1;
  const [binTallies, setBinTallies] = useState(() => Array(binCount).fill(0));
  useEffect(() => setBinTallies(Array(binCount).fill(0)), [binCount]);
  const totalBalls = binTallies.reduce((a, b) => a + b, 0);

  const launchBall = () => {
    const x0 = boardCenterX;
    const y0 = boardTop - spacing * 0.8;
    ballsRef.current.push(new QBall({ x0, y0, r: ballRadius, rows, spacing, pRight, rng: rngRef.current, rowYs }));
  };

  useEffect(() => {
    let id;
    if (running) {
      launchBall();
      id = setInterval(launchBall, Math.max(40, dropIntervalMs));
    }
    return () => id && clearInterval(id);
  }, [running, dropIntervalMs, rows, pRight]);

  const reset = () => { ballsRef.current = []; setBinTallies(Array(binCount).fill(0)); };

  const drawPegs = (ctx) => {
    ctx.fillStyle = "#94a3b8";
    pegRows.forEach((row) => { row.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, pegRadius, 0, Math.PI * 2); ctx.fill(); }); });
  };
  const drawGround = (ctx) => {
    ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1;
    const baseY = height - 20;
    ctx.beginPath();
    ctx.moveTo(boardCenterX - (rows * spacing) / 2 - spacing / 2, boardBottom);
    ctx.lineTo(boardCenterX + (rows * spacing) / 2 + spacing / 2, boardBottom);
    ctx.moveTo(boardCenterX - (rows * spacing) / 2 - spacing / 2, baseY);
    ctx.lineTo(boardCenterX + (rows * spacing) / 2 + spacing / 2, baseY);
    ctx.stroke();
  };

  const G = 1200;
  const BOUNCE_VY = 120;
  const AIR_DAMPING = 0.002;

  useEffect(() => { ballsRef.current = []; setBinTallies(Array(rows + 1).fill(0)); }, [rows]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    let last = performance.now();
    let rafId = 0;

    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

    const step = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;

      ballsRef.current.forEach((b) => {
        if (b.done) return;
        b.vy += G * dt;
        b.vx *= (1 - AIR_DAMPING);
        b.vy *= (1 - AIR_DAMPING * 0.5);

        if (b.txActive) {
          const u = clamp((now - b.txT0) / 1000 / b.txDur, 0, 1);
          const k = easeInOut(u);
          b.x = b.txStart + (b.txTarget - b.txStart) * k;
          if (u >= 1) b.txActive = false;
        } else {
          b.x += b.vx * dt;
        }

        b.y += b.vy * dt;

        if (b.row < b.rows && b.y >= b.rowYs[b.row]) {
          const goRight = b.rng() < b.pRight ? 1 : -1;
          if (goRight > 0) b.rights += 1;
          b.vy = -Math.abs(BOUNCE_VY);
          const leftBound = boardCenterX - (rows * spacing) / 2;
          const rightBound = boardCenterX + (rows * spacing) / 2;
          const targetX = clamp(b.x + goRight * (b.spacing / 2), leftBound + b.r, rightBound - b.r);
          b.txStart = b.x; b.txTarget = targetX; b.txT0 = now; b.txDur = 0.14; b.txActive = true;
          b.vx = 0; b.row += 1;
        }

        const leftWall = boardCenterX - (rows * spacing) / 2 - spacing / 2 + b.r;
        const rightWall = boardCenterX + (rows * spacing) / 2 + spacing / 2 - b.r;
        if (b.x < leftWall) { b.x = leftWall; b.vx = Math.abs(b.vx) * 0.6; }
        if (b.x > rightWall) { b.x = rightWall; b.vx = -Math.abs(b.vx) * 0.6; }

        if (b.y - b.r >= boardBottom) {
          const idx = clamp(b.rights, 0, rows);
          setBinTallies((prev) => { const next = prev.slice(); next[idx] += 1; return next; });
          b.done = true;
        }
      });

      ballsRef.current = ballsRef.current.filter((b) => !b.done);

      ctx.clearRect(0, 0, width, height);
      drawPegs(ctx);
      drawGround(ctx);
      ctx.fillStyle = "#0ea5e9";
      ballsRef.current.forEach((b) => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); });

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [width, height, rows, spacing, boardCenterX, boardBottom, rowYs, G, BOUNCE_VY]);

  const histData = useMemo(() => binTallies.map((v, i) => ({ bin: `${i}`, count: v })), [binTallies]);

  return (
    <div style={styles.page}>
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.row}>
            <h2 style={styles.h2}>Interactive Galton Board</h2>
            <div style={styles.sub}>Rows: {rows} • Balls tallied: {totalBalls}</div>
          </div>
          <div style={styles.btnRow}>
            <button onClick={() => setRunning((r) => !r)} style={styles.btnPrimary}>{running ? "Stop" : "Start"}</button>
            <button onClick={launchBall} style={styles.btnDark}>Drop 1</button>
            <button onClick={reset} style={styles.btnLight}>Reset</button>
          </div>
          <div style={styles.borderBox}>
            <canvas ref={canvasRef} width={width} height={height} style={{ width: "100%", height: "auto", display: "block" }} />
          </div>
        </div>

        <div style={{ ...styles.card, ...styles.sidebar }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>Controls</h3>
          <div>
            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Rows: {rows}</div>
              <input type="range" min={5} max={20} value={rows} onChange={(e) => { setRunning(false); setRows(parseInt(e.target.value)); }} />
            </div>
            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Drop interval (ms): {dropIntervalMs}</div>
              <input type="range" min={40} max={1500} value={dropIntervalMs} onChange={(e) => { setRunning(false); setDropIntervalMs(parseInt(e.target.value)); }} />
            </div>
            <div style={styles.ctlGridRow}>
              <div style={styles.label}>Right probability: {(pRight * 100).toFixed(1)}%</div>
              <input type="range" step={0.01} min={-0.25} max={0.25} value={bias} onChange={(e) => { setRunning(false); setBias(parseFloat(e.target.value)); }} />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontWeight: 600 }}>Live Histogram</h4>
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
        </div>
      </div>
    </div>
  );
}
