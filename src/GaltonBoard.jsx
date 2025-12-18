import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, ReferenceLine } from "recharts";

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

  // Geometry - dynamic sizing based on rows
  const spacing = 28; // fixed spacing
  const pegRadius = 3;
  const ballRadius = 3.2;
  const topMargin = 40;
  const bottomMargin = 200; // Increased to accommodate bins
  const sidePadding = 40; // padding on left and right sides
  const binHeight = 80; // Height of bins below the board
  
  // Calculate dynamic width based on number of rows (bottom row has most pegs)
  const width = useMemo(() => {
    // Bottom row has 'rows' pegs, so width from first to last peg center is (rows - 1) * spacing
    // Add space for peg radius on both sides and padding
    const bottomRowWidth = (rows - 1) * spacing;
    const minWidth = bottomRowWidth + pegRadius * 2 + sidePadding * 2;
    return Math.max(520, minWidth); // Ensure minimum width of 520 for smaller row counts
  }, [rows, spacing, sidePadding, pegRadius]);
  
  // Calculate dynamic height based on number of rows
  const height = useMemo(() => {
    return topMargin + rows * spacing + bottomMargin + binHeight;
  }, [rows, spacing, topMargin, bottomMargin, binHeight]);

  const boardCenterX = width / 2;
  const boardTop = topMargin + 20;
  const boardBottom = height - bottomMargin - binHeight;

  const canvasRef = useRef(null);
  const ballsRef = useRef([]);
  const rngRef = useRef(mulberry32(12345)); // fixed seed
  const intervalRef = useRef(null);
  const launchBallRef = useRef(null);

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

  // Calculate bin centers and positions for visualization
  const binCenters = useMemo(() => {
    const bottomRowWidth = (rows - 1) * spacing;
    const startX = boardCenterX - bottomRowWidth / 2;
    return Array.from({ length: binCount }, (_, i) => ({
      x: startX + i * spacing,
      binIndex: i
    }));
  }, [rows, spacing, boardCenterX, binCount]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (totalBalls === 0) {
      return {
        mean: 0,
        stdDev: 0,
        expectedMean: (0.5 + bias) * rows,
        expectedStdDev: Math.sqrt(rows * (0.5 + bias) * (0.5 - bias))
      };
    }

    // Calculate actual mean
    let sum = 0;
    binTallies.forEach((count, binIndex) => {
      sum += binIndex * count;
    });
    const mean = sum / totalBalls;

    // Calculate variance and standard deviation
    let variance = 0;
    binTallies.forEach((count, binIndex) => {
      variance += count * Math.pow(binIndex - mean, 2);
    });
    variance = variance / totalBalls;
    const stdDev = Math.sqrt(variance);

    // Expected values based on theoretical distribution
    const expectedMean = (0.5 + bias) * rows;
    const expectedVar = rows * (0.5 + bias) * (0.5 - bias);
    const expectedStdDev = Math.sqrt(Math.max(0, expectedVar));

    // Calculate percentages for each bin
    const percentages = binTallies.map(count => 
      totalBalls > 0 ? (count / totalBalls * 100).toFixed(1) : '0.0'
    );

    return {
      mean,
      stdDev,
      expectedMean,
      expectedStdDev,
      percentages
    };
  }, [binTallies, totalBalls, rows, bias]);

  // Keep launchBall function ref updated so interval always uses latest values
  const launchBall = useCallback(() => {
    const x0 = boardCenterX;
    const y0 = boardTop - spacing * 0.8;
    ballsRef.current.push(new QBall({ x0, y0, r: ballRadius, rows, spacing, pRight, rng: rngRef.current, rowYs }));
  }, [boardCenterX, boardTop, spacing, ballRadius, rows, pRight, rowYs]);

  // Update the ref whenever launchBall changes
  useEffect(() => {
    launchBallRef.current = launchBall;
  }, [launchBall]);

  // Handle starting/stopping the simulation
  useEffect(() => {
    if (running) {
      // Only launch immediately when starting fresh (no existing interval)
      if (!intervalRef.current) {
        launchBallRef.current();
      }
      // Clear existing interval if it exists
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      // Set up new interval using ref to avoid stale closures
      intervalRef.current = setInterval(() => {
        if (launchBallRef.current) {
          launchBallRef.current();
        }
      }, Math.max(40, dropIntervalMs));
    } else {
      // Stop the simulation
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running]);

  // Update interval timing when dropIntervalMs changes (without launching extra ball)
  useEffect(() => {
    if (running && intervalRef.current) {
      // Clear existing interval
      clearInterval(intervalRef.current);
      // Set up new interval with updated timing (no immediate launch)
      intervalRef.current = setInterval(() => {
        if (launchBallRef.current) {
          launchBallRef.current();
        }
      }, Math.max(40, dropIntervalMs));
    }
  }, [dropIntervalMs, running]);

  const reset = () => { ballsRef.current = []; setBinTallies(Array(binCount).fill(0)); };

  const drawPegs = (ctx) => {
    ctx.fillStyle = "#94a3b8";
    pegRows.forEach((row) => { row.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, pegRadius, 0, Math.PI * 2); ctx.fill(); }); });
  };
  
  const drawBins = (ctx) => {
    const binTop = boardBottom + 10;
    const binBottom = height - 20;
    const maxCount = Math.max(...binTallies, 1);
    
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    
    // Draw bin dividers
    binCenters.forEach((bin, i) => {
      ctx.beginPath();
      ctx.moveTo(bin.x, binTop);
      ctx.lineTo(bin.x, binBottom);
      ctx.stroke();
    });

    // Draw accumulated balls in bins (simplified representation)
    ctx.fillStyle = "#0ea5e9";
    binCenters.forEach((bin, i) => {
      const count = binTallies[i];
      if (count > 0 && maxCount > 0) {
        const barHeight = (count / maxCount) * (binBottom - binTop);
        const barTop = binBottom - barHeight;
        const barWidth = spacing * 0.7;
        
        // Draw a filled rectangle representing the balls
        ctx.fillRect(bin.x - barWidth / 2, barTop, barWidth, barHeight);
        
        // Draw individual ball circles on top for visual effect (limited number)
        const maxVisibleBalls = Math.min(20, count);
        const rowsOfBalls = Math.ceil(Math.sqrt(maxVisibleBalls));
        const colsOfBalls = Math.ceil(maxVisibleBalls / rowsOfBalls);
        const ballSize = Math.min(ballRadius * 0.7, barWidth / (colsOfBalls + 1));
        const xSpacing = barWidth / (colsOfBalls + 1);
        const ySpacing = barHeight / (rowsOfBalls + 1);
        
        for (let j = 0; j < maxVisibleBalls; j++) {
          const row = Math.floor(j / colsOfBalls);
          const col = j % colsOfBalls;
          const ballX = bin.x - barWidth / 2 + (col + 1) * xSpacing;
          const ballY = barTop + (row + 1) * ySpacing;
          ctx.beginPath();
          ctx.arc(ballX, ballY, ballSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  };
  
  const drawGround = (ctx) => {
    ctx.strokeStyle = "#cbd5e1"; 
    ctx.lineWidth = 1;
    // Bottom row has 'rows' pegs, so width is (rows - 1) * spacing
    const bottomRowWidth = (rows - 1) * spacing;
    ctx.beginPath();
    ctx.moveTo(boardCenterX - bottomRowWidth / 2 - spacing / 2, boardBottom);
    ctx.lineTo(boardCenterX + bottomRowWidth / 2 + spacing / 2, boardBottom);
    ctx.stroke();
  };

  const G = 1200;
  const BOUNCE_VY = 120;
  const AIR_DAMPING = 0.002;

  useEffect(() => { ballsRef.current = []; setBinTallies(Array(rows + 1).fill(0)); }, [rows]);

  // Update canvas dimensions when height changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  }, [width, height]);

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
          // Current row has (b.row + 1) pegs, so width is b.row * spacing
          const currentRowWidth = b.row * spacing;
          const leftBound = boardCenterX - currentRowWidth / 2;
          const rightBound = boardCenterX + currentRowWidth / 2;
          const targetX = clamp(b.x + goRight * (b.spacing / 2), leftBound + b.r, rightBound - b.r);
          b.txStart = b.x; b.txTarget = targetX; b.txT0 = now; b.txDur = 0.14; b.txActive = true;
          b.vx = 0; b.row += 1;
        }

        // Bottom row has 'rows' pegs, so width is (rows - 1) * spacing
        const bottomRowWidth = (rows - 1) * spacing;
        const leftWall = boardCenterX - bottomRowWidth / 2 - spacing / 2 + b.r;
        const rightWall = boardCenterX + bottomRowWidth / 2 + spacing / 2 - b.r;
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
      drawBins(ctx);
      ctx.fillStyle = "#0ea5e9";
      ballsRef.current.forEach((b) => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); });

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [width, height, rows, spacing, boardCenterX, boardBottom, rowYs, G, BOUNCE_VY, pegRows, binCenters, binTallies, binHeight]);

  // Calculate standard deviation positions
  const stdDevPositions = useMemo(() => {
    if (totalBalls === 0 || stats.stdDev === 0) return [];
    const positions = [];
    const mean = stats.mean;
    const sd = stats.stdDev;
    
    // Calculate positions for -3σ, -2σ, -1σ, 0, 1σ, 2σ, 3σ
    for (let i = -3; i <= 3; i++) {
      const position = mean + (i * sd);
      if (position >= 0 && position < binCount) {
        positions.push({
          value: i,
          position: position,
          label: i === 0 ? 'μ' : `${i}σ`
        });
      }
    }
    return positions;
  }, [stats, binCount, totalBalls]);

  const histData = useMemo(() => {
    // Convert counts to percentages
    const data = binTallies.map((v, i) => ({ 
      bin: `${i}`, 
      count: v,
      percentage: totalBalls > 0 ? (v / totalBalls * 100) : 0,
      normal: 0 
    }));
    
    // Calculate normal distribution curve points (as percentages)
    if (totalBalls > 10 && stats.stdDev > 0.1) {
      const maxPercentage = Math.max(...data.map(d => d.percentage), 1);
      
      for (let i = 0; i < binCount; i++) {
        // Normal distribution PDF
        const x = i;
        const mu = stats.mean;
        const sigma = stats.stdDev;
        
        if (sigma > 0) {
          const coefficient = 1 / (sigma * Math.sqrt(2 * Math.PI));
          const exponent = -0.5 * Math.pow((x - mu) / sigma, 2);
          const pdfValue = coefficient * Math.exp(exponent);
          
          // Convert PDF to percentage (scale to match the histogram)
          // The PDF value needs to be scaled to percentage
          const maxPdf = coefficient; // Maximum PDF value (at mean)
          const scaledPercentage = (pdfValue / maxPdf) * maxPercentage;
          
          data[i].normal = scaledPercentage;
        }
      }
    }
    
    return data;
  }, [binTallies, totalBalls, stats, binCount]);
  
  // Calculate max percentage for Y-axis ticks
  const maxPercentage = useMemo(() => {
    return Math.max(...histData.map(d => d.percentage), 1);
  }, [histData]);
  
  // Calculate appropriate Y-axis ticks for percentages
  const yAxisTicks = useMemo(() => {
    if (maxPercentage <= 20) {
      // Show every 2nd percentage up to maxPercentage
      const ticks = [];
      for (let i = 0; i <= maxPercentage; i += 2) {
        ticks.push(i);
      }
      return ticks;
    } else if (maxPercentage <= 50) {
      // Show every 5th percentage
      const ticks = [];
      for (let i = 0; i <= maxPercentage; i += 5) {
        ticks.push(i);
      }
      return ticks;
    } else {
      // Show ~10 ticks
      const step = Math.ceil(maxPercentage / 10);
      const ticks = [];
      for (let i = 0; i <= maxPercentage; i += step) {
        ticks.push(i);
      }
      return ticks;
    }
  }, [maxPercentage]);

  return (
    <div className="w-full min-h-screen bg-slate-50 flex items-center justify-center py-8">
      <div className="w-full max-w-7xl mx-auto px-4 box-border text-slate-900 flex flex-col gap-6">
        {/* Controls at Top */}
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8 pb-6 border-b border-slate-200">
            <h1 className="text-2xl sm:text-3xl font-bold m-0 text-slate-900">Interactive Galton Board</h1>
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={() => setRunning((r) => !r)} 
                className="px-6 py-2.5 rounded-lg border-0 bg-[#1e4e78] hover:bg-[#1a4266] text-white cursor-pointer font-semibold transition-all shadow-md hover:shadow-lg active:scale-95"
              >
                {running ? "⏸ Stop" : "▶ Start"}
              </button>
              <button 
                onClick={launchBall} 
                className="px-6 py-2.5 rounded-lg border-0 bg-[#1e4e78] hover:bg-[#1a4266] text-white cursor-pointer font-semibold transition-all shadow-md hover:shadow-lg active:scale-95"
              >
                Drop 1 Ball
              </button>
              <button 
                onClick={reset} 
                className="px-6 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 cursor-pointer font-semibold transition-all shadow-sm hover:shadow-md active:scale-95"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-slate-700">Rows</label>
                <span className="text-lg font-bold text-[#1e4e78] bg-white px-3 py-1 rounded-md">{rows}</span>
              </div>
              <input 
                type="range" 
                min={5} 
                max={20} 
                value={rows} 
                onChange={(e) => { setRows(parseInt(e.target.value)); }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1e4e78]"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>5</span>
                <span>20</span>
              </div>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-slate-700">Drop Interval</label>
                <span className="text-lg font-bold text-[#1e4e78] bg-white px-3 py-1 rounded-md">{dropIntervalMs}ms</span>
              </div>
              <input 
                type="range" 
                min={40} 
                max={1500} 
                value={dropIntervalMs} 
                onChange={(e) => { setDropIntervalMs(parseInt(e.target.value)); }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1e4e78]"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>40ms</span>
                <span>1500ms</span>
              </div>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-slate-700">Right Probability</label>
                <span className="text-lg font-bold text-[#1e4e78] bg-white px-3 py-1 rounded-md">{(pRight * 100).toFixed(1)}%</span>
              </div>
              <input 
                type="range" 
                step={0.01} 
                min={-0.25} 
                max={0.25} 
                value={bias} 
                onChange={(e) => { setBias(parseFloat(e.target.value)); }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1e4e78]"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>25%</span>
                <span>75%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Board Card - Centered */}
        <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 mx-auto w-full max-w-4xl">
          <div className="relative w-full border-2 border-[#f2f2f2] rounded-xl overflow-hidden bg-[#f7f7f7] mb-4">
            <canvas 
              ref={canvasRef} 
              width={width} 
              height={height} 
              className="w-full h-auto block" 
            />
          </div>
          <div className="text-sm text-slate-600 text-center">
            <p className="mb-2"><strong>Balls tallied:</strong> {totalBalls}</p>
            <p className="text-xs text-slate-500 italic">
              Eventually the distribution will approach what is called the normal distribution.
            </p>
          </div>
        </div>

        {/* Statistics and Distribution at Bottom - Full Width */}
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
          <h3 className="text-2xl font-bold mb-8 text-slate-900 border-b-2 border-slate-200 pb-4">Statistics & Distribution</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Key Metrics */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Key Metrics</h4>
              <div className="grid grid-cols-2 gap-4">
                {/* Actual Statistics */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-5 border border-blue-200 shadow-sm">
                  <div className="text-xs text-blue-700 uppercase tracking-wide mb-3 font-semibold">Actual (Observed)</div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs text-blue-600 font-medium mb-1">Mean</div>
                      <div className="text-3xl font-bold text-blue-900">{stats.mean.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-600 font-medium mb-1">Std Dev</div>
                      <div className="text-3xl font-bold text-blue-900">{stats.stdDev.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
                
                {/* Expected Statistics */}
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-5 border border-slate-200 shadow-sm">
                  <div className="text-xs text-slate-600 uppercase tracking-wide mb-3 font-semibold">Expected (Theoretical)</div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs text-slate-600 font-medium mb-1">Mean</div>
                      <div className="text-3xl font-bold text-slate-800">{stats.expectedMean.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-600 font-medium mb-1">Std Dev</div>
                      <div className="text-3xl font-bold text-slate-800">{stats.expectedStdDev.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bin Percentages */}
            {totalBalls > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Bin Percentages</h4>
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                    {binTallies.map((count, i) => (
                      <div 
                        key={i} 
                        className="bg-white rounded-lg p-3 text-center border border-slate-200 hover:border-[#1e4e78] hover:shadow-md transition-all"
                      >
                        <div className="text-xs font-semibold text-slate-600 mb-1">Bin {i}</div>
                        <div className="text-xl font-bold text-[#1e4e78] mb-1">{stats.percentages[i]}%</div>
                        <div className="text-xs text-slate-500">{count} balls</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Histogram - Full Width */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-semibold text-slate-900">Distribution (Percentages)</h4>
              {totalBalls > 10 && stats.stdDev > 0 && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <div className="w-4 h-0.5 bg-red-500"></div>
                  <span>Theoretical Normal Distribution</span>
                </div>
              )}
            </div>
            <div className="bg-[#f7f7f7] rounded-xl p-6 border-2 border-[#f2f2f2]">
              <div className="h-80 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="bin" 
                      tick={{ fontSize: 11, fill: '#64748b' }} 
                      label={{ value: "Bin", position: "insideBottom", offset: -5, style: { fontSize: 12, fill: '#475569' } }} 
                    />
                    <YAxis 
                      allowDecimals={true}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      ticks={yAxisTicks}
                      domain={[0, 'dataMax']}
                      label={{ value: "Percentage (%)", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: '#475569' } }}
                    />
                    <Tooltip 
                      cursor={{ fill: "rgba(0,0,0,0.03)" }}
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        border: '1px solid #e2e8f0', 
                        borderRadius: '8px',
                        padding: '8px'
                      }}
                      formatter={(value, name) => {
                        if (name === 'percentage') {
                          return [`${value.toFixed(1)}%`, 'Percentage'];
                        }
                        return value;
                      }}
                    />
                    <Bar dataKey="percentage" fill="#0ea5e9" radius={[6, 6, 0, 0]} name="Percentage" />
                    {/* Standard deviation reference lines */}
                    {stdDevPositions.map((sd, idx) => (
                      <ReferenceLine
                        key={idx}
                        x={`${Math.round(sd.position)}`}
                        stroke="#94a3b8"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        label={{ value: sd.label, position: "bottom", fontSize: 10, fill: '#64748b', fontWeight: 'bold', offset: 5 }}
                      />
                    ))}
                    {totalBalls > 10 && stats.stdDev > 0 && (
                      <Line 
                        type="monotone" 
                        dataKey="normal" 
                        stroke="#ef4444" 
                        strokeWidth={2} 
                        dot={false}
                        name="Normal Distribution"
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
