import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, ReferenceLine, LabelList } from "recharts";

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
  const [ballsDropped, setBallsDropped] = useState(0);
  const [showStats, setShowStats] = useState(true);
  const [dropCount, setDropCount] = useState(1); // Number of balls to drop at once

  // Geometry - dynamic sizing based on rows
  const spacing = 36; // increased spacing for wider layout
  const pegRadius = 4;
  const ballRadius = 4;
  const topMargin = 40;
  const bottomMargin = 200; // Increased to accommodate bins
  const sidePadding = 50; // padding on left and right sides
  const binHeight = 30; // Fixed height for bins (very short)
  const gapBeforeHorizontalLine = 3; // Small gap between last peg row and column separators (like real Galton board)

  const canvasRef = useRef(null);
  const ballsRef = useRef([]);
  const rngRef = useRef(mulberry32(12345)); // fixed seed
  const intervalRef = useRef(null);
  const launchBallRef = useRef(null);
  const dropNBallsIntervalRef = useRef(null); // For dropping N balls at intervals

  const pRight = clamp(0.5 + bias, 0, 1);

  const binCount = rows + 1; // N+1 columns for N rows (column i = went right i times)
  const [binTallies, setBinTallies] = useState(() => Array(binCount).fill(0));
  useEffect(() => setBinTallies(Array(binCount).fill(0)), [binCount]);
  
  const totalBalls = binTallies.reduce((a, b) => a + b, 0);
  
  // Compute max count for bar scaling (tallest bar fills available space)
  const maxBinCount = useMemo(() => Math.max(...binTallies, 1), [binTallies]);
  
  // Calculate dynamic width based on number of rows (bottom row has most pegs)
  const width = useMemo(() => {
    // Bottom row has 'rows' pegs, so width from first to last peg center is (rows - 1) * spacing
    // Add space for peg radius on both sides and padding
    const bottomRowWidth = (rows - 1) * spacing;
    const minWidth = bottomRowWidth + pegRadius * 2 + sidePadding * 2;
    return Math.max(520, minWidth); // Ensure minimum width of 520 for smaller row counts
  }, [rows, spacing, sidePadding, pegRadius]);
  
  const boardCenterX = width / 2;
  const boardTop = topMargin + 20;
  
  // Calculate dynamic height based on number of rows
  const height = useMemo(() => {
    const lastPegRowY = boardTop + (rows - 1) * spacing;
    const boardBottom = lastPegRowY + gapBeforeHorizontalLine;
    return boardBottom + bottomMargin + binHeight;
  }, [rows, spacing, boardTop, bottomMargin, binHeight, gapBeforeHorizontalLine]);
  
  // Calculate where the last peg row ends, then add gap before horizontal line
  const lastPegRowY = boardTop + (rows - 1) * spacing;
  const boardBottom = lastPegRowY + gapBeforeHorizontalLine;
  const binBottom = useMemo(() => height - 40, [height]); // Leave space at bottom for larger tally numbers

  const pegRows = useMemo(() => {
    const rowsArr = [];
    // Standard triangular lattice: Row 0 has 1 peg, Row 1 has 2 pegs, Row N has N+1 pegs
    for (let r = 0; r < rows; r++) {
      const y = boardTop + r * spacing;
      const count = r + 1; // Row r has r+1 pegs
      
      // All rows use the same triangular pattern, centered at boardCenterX
      const rowWidth = (count - 1) * spacing;
      const startX = boardCenterX - rowWidth / 2;
      const pegs = Array.from({ length: count }, (_, i) => ({
        x: startX + i * spacing,
        y
      }));
      rowsArr.push(pegs);
    }
    return rowsArr;
  }, [rows, spacing, boardTop, boardCenterX]);

  const rowYs = useMemo(() => pegRows.map(r => r[0]?.y ?? boardTop), [pegRows, boardTop]);

  // Calculate bin centers and positions for visualization
  // Columns are the spaces between walls (which are directly below bottom row pegs)
  // If bottom row has N pegs, there are N walls, creating N+1 columns (left of first wall, between walls, right of last wall)
  // But we use binCount = rows columns, so we use the spaces between the walls
  const binCenters = useMemo(() => {
    const bottomRow = pegRows[rows - 1];
    if (!bottomRow || bottomRow.length === 0) {
      // Fallback to calculated positions
      const totalBinWidth = rows * spacing;
      const startX = boardCenterX - totalBinWidth / 2 + spacing / 2;
      return Array.from({ length: binCount }, (_, i) => ({
        x: startX + i * spacing,
        binIndex: i
      }));
    }
    
    // Walls are at each peg position in the bottom row
    // For rows pegs, we have rows walls, which create rows bins (spaces between walls)
    // Bins are the spaces BETWEEN consecutive walls:
    // - Bin 0: between left edge and first wall
    // - Bin 1 to binCount-2: between consecutive walls
    // - Bin binCount-1: between last wall and right edge
    const firstPegX = bottomRow[0].x;
    const lastPegX = bottomRow[bottomRow.length - 1].x;
    // Make outer walls full spacing away so all bins have equal width
    const leftEdge = firstPegX - spacing;
    const rightEdge = lastPegX + spacing;
    
    // With rows pegs in bottom row, we have rows+1 bins (binCount = rows+1)
    // Bin 0: between left outer wall and first peg
    // Bin 1 to rows-1: between consecutive pegs
    // Bin rows: between last peg and right outer wall
    return Array.from({ length: binCount }, (_, i) => {
      let leftBoundary, rightBoundary;
      if (i === 0) {
        // First bin: between left outer wall and first peg wall
        leftBoundary = leftEdge;
        rightBoundary = bottomRow[0].x;
      } else if (i === binCount - 1) {
        // Last bin: between last peg wall and right outer wall
        leftBoundary = bottomRow[bottomRow.length - 1].x;
        rightBoundary = rightEdge;
      } else {
        // Middle bins: between peg i-1 and peg i
        leftBoundary = bottomRow[i - 1].x;
        rightBoundary = bottomRow[i].x;
      }
      // Perfectly center the bin center exactly in the middle between boundaries
      const centerX = (leftBoundary + rightBoundary) / 2;
      return {
        x: centerX,
        binIndex: i
      };
    });
  }, [rows, spacing, boardCenterX, binCount, pegRows]);

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
    setBallsDropped((d) => d + 1);
  }, [boardCenterX, boardTop, spacing, ballRadius, rows, pRight, rowYs]);

  // Drop N balls at the current drop interval (not all at once)
  const dropNBalls = useCallback((n) => {
    const count = Math.max(1, Math.min(1000, n)); // Limit to 1-1000
    let dropped = 0;
    
    // Clear any existing dropNBalls interval
    if (dropNBallsIntervalRef.current) {
      clearInterval(dropNBallsIntervalRef.current);
    }
    
    // Drop first ball immediately
    const x0 = boardCenterX;
    const y0 = boardTop - spacing * 0.8;
    ballsRef.current.push(new QBall({ x0, y0, r: ballRadius, rows, spacing, pRight, rng: rngRef.current, rowYs }));
    setBallsDropped((d) => d + 1);
    dropped++;
    
    // If more balls to drop, set up interval
    if (dropped < count) {
      dropNBallsIntervalRef.current = setInterval(() => {
        const x0 = boardCenterX;
        const y0 = boardTop - spacing * 0.8;
        ballsRef.current.push(new QBall({ x0, y0, r: ballRadius, rows, spacing, pRight, rng: rngRef.current, rowYs }));
        setBallsDropped((d) => d + 1);
        dropped++;
        
        if (dropped >= count) {
          clearInterval(dropNBallsIntervalRef.current);
          dropNBallsIntervalRef.current = null;
        }
      }, Math.max(40, dropIntervalMs));
    }
  }, [boardCenterX, boardTop, spacing, ballRadius, rows, pRight, rowYs, dropIntervalMs]);

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

  const reset = () => { 
    // Clear any pending dropNBalls interval
    if (dropNBallsIntervalRef.current) {
      clearInterval(dropNBallsIntervalRef.current);
      dropNBallsIntervalRef.current = null;
    }
    ballsRef.current = []; 
    setBinTallies(Array(binCount).fill(0)); 
    setBallsDropped(0);
  };

  const drawPegs = (ctx) => {
    ctx.fillStyle = "#94a3b8";
    pegRows.forEach((row) => { row.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, pegRadius, 0, Math.PI * 2); ctx.fill(); }); });
  };
  
  const drawBins = (ctx) => {
    const binTop = boardBottom + 2; // Start columns just below the pegs (small gap like real board)
    const maxCount = Math.max(...binTallies, 1);
    
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    
    // Draw vertical walls directly below each peg in the bottom row
    // Anchor Rule: Walls must strictly align with pegs of the final row
    const bottomRow = pegRows[rows - 1];
    if (bottomRow && bottomRow.length > 0) {
      
      const firstPegX = bottomRow[0].x;
      const lastPegX = bottomRow[bottomRow.length - 1].x;
      // Make outer walls full spacing away so all bins have equal width
      const leftWallX = firstPegX - spacing;
      const rightWallX = lastPegX + spacing;
      
      // Draw outer left wall
      ctx.beginPath();
      ctx.moveTo(leftWallX, boardBottom);
      ctx.lineTo(leftWallX, binBottom);
      ctx.stroke();
      
      // Draw walls at each peg position
      bottomRow.forEach((peg) => {
        const wallX = peg.x; // Wall x-position = peg x-position exactly (no offsets)
        const wallStartY = peg.y; // Wall starts at the peg's y position
        ctx.beginPath();
        ctx.moveTo(wallX, wallStartY);
        ctx.lineTo(wallX, binBottom);
        ctx.stroke();
      });
      
      // Draw outer right wall
      ctx.beginPath();
      ctx.moveTo(rightWallX, boardBottom);
      ctx.lineTo(rightWallX, binBottom);
      ctx.stroke();
    }

    // Draw accumulated balls in bins (simplified representation)
    // Bars grow dynamically - tallest bar uses full available height
    ctx.fillStyle = "#0ea5e9";
    binCenters.forEach((bin, i) => {
      const count = binTallies[i];
      if (count > 0 && maxCount > 0) {
        // Calculate bar height - scale based on max count (tallest bar fills available space)
        const availableHeight = binBottom - binTop;
        const barHeight = (count / maxCount) * availableHeight;
        // Allow bar to extend upward if needed (but don't go above boardBottom)
        const barTop = Math.max(boardBottom - barHeight, binBottom - barHeight);
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

    // Draw tally numbers at the bottom of each column - perfectly centered
    ctx.fillStyle = "#1e293b";
    ctx.font = "500 14px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // Draw for all bins (0 through binCount-1)
    for (let i = 0; i < binCount && i < binCenters.length && i < binTallies.length; i++) {
      const count = binTallies[i];
      const bin = binCenters[i];
      const textY = binBottom + 8; // Position text just below the column
      ctx.fillText(count.toString(), bin.x, textY);
    }
  };
  
  const drawGround = (ctx) => {
    ctx.strokeStyle = "#cbd5e1"; 
    ctx.lineWidth = 1;
    // Draw horizontal bar full width
    const margin = 20; // Small margin from edges
    ctx.beginPath();
    ctx.moveTo(margin, boardBottom);
    ctx.lineTo(width - margin, boardBottom);
    ctx.stroke();
  };

  const G = 1200; // Gravity acceleration (pixels per second squared)
  const BOUNCE_VY = 120; // Bounce velocity after hitting a peg
  const AIR_DAMPING = 0.002; // Air resistance (horizontal only)

  useEffect(() => { 
    ballsRef.current = []; 
    setBinTallies(Array(rows + 1).fill(0)); 
    setBallsDropped(0);
  }, [rows]);
  useEffect(() => { 
    ballsRef.current = []; 
    setBinTallies(Array(rows + 1).fill(0)); 
    setBallsDropped(0);
  }, [bias]);

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

        // Check for peg collision - when ball reaches a row
        if (b.row < b.rows && b.y >= b.rowYs[b.row]) {
          const goRight = b.rng() < b.pRight ? 1 : -1;
          if (goRight > 0) b.rights += 1;
          b.vy = -Math.abs(BOUNCE_VY);
          
          // Calculate target position for the next row
          const nextRow = b.row + 1;
          const nextRowCount = nextRow + 1;
          const nextRowWidth = (nextRowCount - 1) * spacing;
          const nextRowStartX = boardCenterX - nextRowWidth / 2;
          const leftBound = nextRowStartX + b.r;
          const rightBound = nextRowStartX + nextRowWidth - b.r;
          const targetX = clamp(b.x + goRight * (b.spacing / 2), leftBound, rightBound);
          
          b.txStart = b.x; 
          b.txTarget = targetX; 
          b.txT0 = now; 
          b.txDur = 0.14; 
          b.txActive = true;
          b.vx = 0; 
          b.row += 1;
        }

        // Wall boundaries
        const bottomRow = pegRows[rows - 1];
        if (bottomRow && bottomRow.length > 0) {
          const firstPegX = bottomRow[0].x;
          const lastPegX = bottomRow[bottomRow.length - 1].x;
          const leftWallX = firstPegX - spacing / 2;
          const rightWallX = lastPegX + spacing / 2;
          const leftWall = leftWallX + b.r;
          const rightWall = rightWallX - b.r;
          if (b.x < leftWall) { b.x = leftWall; b.vx = Math.abs(b.vx) * 0.6; }
          if (b.x > rightWall) { b.x = rightWall; b.vx = -Math.abs(b.vx) * 0.6; }
        } else {
          // Fallback
          const totalBinWidth = rows * spacing;
          const leftmostDividerX = boardCenterX - totalBinWidth / 2;
          const leftWall = leftmostDividerX + b.r;
          const rightWall = leftmostDividerX + binCount * spacing - b.r;
          if (b.x < leftWall) { b.x = leftWall; b.vx = Math.abs(b.vx) * 0.6; }
          if (b.x > rightWall) { b.x = rightWall; b.vx = -Math.abs(b.vx) * 0.6; }
        }

        if (b.y - b.r >= boardBottom) {
          // Determine column based on x position
          const bottomRow = pegRows[rows - 1];
          if (bottomRow && bottomRow.length > 0) {
            const firstPegX = bottomRow[0].x;
            const lastPegX = bottomRow[bottomRow.length - 1].x;
            let columnIndex = 0;
            if (b.x < firstPegX) {
              columnIndex = 0;
            } else if (b.x >= lastPegX) {
              columnIndex = binCount - 1;
            } else {
              for (let i = 0; i < bottomRow.length - 1; i++) {
                if (b.x >= bottomRow[i].x && b.x < bottomRow[i + 1].x) {
                  columnIndex = i + 1;
                  break;
                }
              }
            }
            const idx = clamp(columnIndex, 0, binCount - 1);
            setBinTallies((prev) => { const next = prev.slice(); next[idx] += 1; return next; });
          } else {
            const idx = clamp(b.rights, 0, binCount - 1);
            setBinTallies((prev) => { const next = prev.slice(); next[idx] += 1; return next; });
          }
          b.done = true;
        }
      });

      ballsRef.current = ballsRef.current.filter((b) => !b.done);

      ctx.clearRect(0, 0, width, height);
      drawPegs(ctx);
      drawBins(ctx);
      ctx.fillStyle = "#0ea5e9";
      ballsRef.current.forEach((b) => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); });

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [width, height, rows, spacing, boardCenterX, boardBottom, rowYs, G, BOUNCE_VY, AIR_DAMPING, pegRows, binCenters, binTallies, binHeight, binBottom, binCount]);

  // Calculate standard deviation positions
  const stdDevPositions = useMemo(() => {
    if (totalBalls === 0 || stats.stdDev === 0 || stats.stdDev < 0.1) return [];
    const positions = [];
    const mean = stats.mean;
    const sd = stats.stdDev;
    
    // Calculate positions for -3σ, -2σ, -1σ, μ (0), 1σ, 2σ, 3σ
    // Only include positions that are within valid bin range
    for (let i = -3; i <= 3; i++) {
      const position = mean + (i * sd);
      const binIndex = Math.round(position);
      if (binIndex >= 0 && binIndex < binCount) {
        // Avoid duplicates by checking binIndex instead of position
        const existing = positions.find(p => p.binIndex === binIndex);
        if (!existing) {
          positions.push({
            value: i,
            position: position,
            binIndex: binIndex,
            label: i === 0 ? 'μ' : `${i}σ`
          });
        }
      }
    }
    return positions.sort((a, b) => a.binIndex - b.binIndex);
  }, [stats, binCount, totalBalls]);

  const histData = useMemo(() => {
    // Convert counts to percentages
    const data = binTallies.map((v, i) => ({ 
      bin: `${i}`, 
      count: v,
      percentage: totalBalls > 0 ? (v / totalBalls * 100) : 0,
      barLabel: totalBalls > 0 ? `${v} (${(v / totalBalls * 100).toFixed(1)}%)` : '0 (0.0%)',
      normal: 0 
    }));
    
    // Calculate normal distribution curve points (as percentages)
    if (totalBalls > 10 && stats.stdDev > 0.1) {
      const maxPercentage = Math.max(...data.map(d => d.percentage), 1);
      const mu = stats.mean;
      const sigma = stats.stdDev;
      
      if (sigma > 0 && maxPercentage > 0) {
        // Calculate the area under the normal curve that should match the total percentage
        // We'll scale the PDF to match the peak of the histogram
        let maxNormalValue = 0;
        const normalValues = [];
        
        for (let i = 0; i < binCount; i++) {
          const x = i;
          const coefficient = 1 / (sigma * Math.sqrt(2 * Math.PI));
          const exponent = -0.5 * Math.pow((x - mu) / sigma, 2);
          const pdfValue = coefficient * Math.exp(exponent);
          normalValues.push(pdfValue);
          maxNormalValue = Math.max(maxNormalValue, pdfValue);
        }
        
        // Scale to match the histogram peak
        if (maxNormalValue > 0) {
          for (let i = 0; i < binCount; i++) {
            data[i].normal = (normalValues[i] / maxNormalValue) * maxPercentage;
          }
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
    <div className="w-full min-h-screen bg-slate-50 flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-7xl mx-auto px-4 box-border text-slate-900 flex flex-col gap-5">
        {/* Controls at Top */}
        <div className="bg-white rounded-xl shadow-md p-5 sm:p-6 mx-auto w-full max-w-4xl">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 pb-4 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-4">
              <h1 className="text-xl sm:text-2xl font-bold m-0 text-slate-900">Interactive Galton Board</h1>
              <span className="text-sm text-slate-600">
                <strong>Balls dropped:</strong> {ballsDropped} &nbsp;|&nbsp; <strong>Tallied:</strong> {totalBalls}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setRunning((r) => !r)} 
                className="px-5 py-2 rounded-lg border-0 bg-[#1e4e78] hover:bg-[#1a4266] text-white cursor-pointer font-medium transition-all shadow-sm hover:shadow active:scale-95 text-sm whitespace-nowrap"
              >
                {running ? "⏸ Stop" : "▶ Start"}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-700">Drop</span>
                <input 
                  type="number" 
                  min={1} 
                  max={1000} 
                  value={dropCount} 
                  onChange={(e) => setDropCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 px-2 py-1.5 rounded-lg border border-slate-300 text-center text-sm font-medium"
                />
                <button 
                  onClick={() => dropNBalls(dropCount)} 
                  className="px-4 py-2 rounded-lg border-0 bg-[#1e4e78] hover:bg-[#1a4266] text-white cursor-pointer font-medium transition-all shadow-sm hover:shadow active:scale-95 text-sm whitespace-nowrap"
                >
                  Ball{dropCount > 1 ? 's' : ''}
                </button>
              </div>
              <button 
                onClick={reset} 
                className="px-5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 cursor-pointer font-medium transition-all shadow-sm hover:shadow active:scale-95 text-sm whitespace-nowrap"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">Rows</label>
                <span className="text-base font-bold text-[#1e4e78] bg-white px-2 py-0.5 rounded-md">{rows}</span>
              </div>
              <input 
                type="range" 
                min={1} 
                max={20} 
                value={rows} 
                onChange={(e) => { setRows(parseInt(e.target.value)); }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1e4e78]"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>1</span>
                <span>20</span>
              </div>
            </div>
            
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">Left/Right Probability</label>
                <span className="text-base font-bold text-[#1e4e78] bg-white px-2 py-0.5 rounded-md">{((1 - pRight) * 100).toFixed(0)}% / {(pRight * 100).toFixed(0)}%</span>
              </div>
              <input 
                type="range" 
                step={0.01} 
                min={-0.5} 
                max={0.5} 
                value={bias} 
                onChange={(e) => { setBias(parseFloat(e.target.value)); }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1e4e78]"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>100% / 0%</span>
                <span>0% / 100%</span>
              </div>
            </div>
            
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">Drop Interval</label>
                <span className="text-base font-bold text-[#1e4e78] bg-white px-2 py-0.5 rounded-md">{(dropIntervalMs / 1000).toFixed(2)} s</span>
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
                <span>0.04 s</span>
                <span>1.5 s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Board Card - Centered */}
        <div className="bg-white rounded-xl shadow-md p-4 sm:p-5 mx-auto w-full max-w-4xl">
          <div className="relative w-full max-h-[70vh] overflow-x-auto overflow-y-hidden border-2 border-[#f2f2f2] rounded-lg bg-[#f7f7f7] flex items-start justify-center">
            <canvas 
              ref={canvasRef} 
              width={width} 
              height={height} 
              className="max-h-[70vh] w-auto h-auto object-contain block" 
            />
          </div>
        </div>

        {/* Toggle and Statistics and Distribution at Bottom - Full Width */}
        <div className="mx-auto w-full max-w-4xl flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setShowStats((prev) => !prev)}
            className="flex items-center gap-3 cursor-pointer text-base text-slate-700 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <span className={`w-5 h-5 rounded border-2 flex items-center justify-center ${showStats ? 'bg-[#1e4e78] border-[#1e4e78]' : 'border-slate-400'}`}>
              {showStats && <span className="text-white text-sm font-bold">✓</span>}
            </span>
            Show Statistics & Distribution
          </button>
        </div>
        {showStats && (
        <div className="bg-white rounded-xl shadow-md p-5 sm:p-6 mx-auto w-full max-w-4xl">
          <h3 className="text-xl font-bold mb-6 text-slate-900 border-b border-slate-200 pb-3">Statistics & Distribution</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Key Metrics */}
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-3 uppercase tracking-wide">Key Metrics</h4>
              <div className="grid grid-cols-2 gap-3">
                {/* Actual Statistics */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                  <div className="text-xs text-blue-700 uppercase tracking-wide mb-2 font-semibold">Actual (Observed)</div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-blue-600 font-medium mb-1">Mean</div>
                      <div className="text-2xl font-bold text-blue-900">{stats.mean.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-600 font-medium mb-1">Std Dev</div>
                      <div className="text-2xl font-bold text-blue-900">{stats.stdDev.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
                
                {/* Expected Statistics */}
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg p-4 border border-slate-200">
                  <div className="text-xs text-slate-600 uppercase tracking-wide mb-2 font-semibold">Expected (Theoretical)</div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-slate-600 font-medium mb-1">Mean</div>
                      <div className="text-2xl font-bold text-slate-800">{stats.expectedMean.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-600 font-medium mb-1">Std Dev</div>
                      <div className="text-2xl font-bold text-slate-800">{stats.expectedStdDev.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bin Percentages */}
            {totalBalls > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-3 uppercase tracking-wide">Bin Percentages</h4>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-4 xl:grid-cols-6 gap-1.5">
                    {binTallies.map((count, i) => (
                      <div 
                        key={i} 
                        className="bg-white rounded-md p-1.5 text-center border border-slate-200 hover:border-[#1e4e78] hover:shadow-sm transition-all min-w-0 overflow-hidden"
                      >
                        <div className="text-[10px] font-semibold text-slate-600 mb-0.5">Col {i}</div>
                        <div className="text-xs font-bold text-[#1e4e78] mb-0.5">{stats.percentages[i]}%</div>
                        <div className="text-[10px] text-slate-500">{count} balls</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Histogram - Full Width */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-semibold text-slate-900">Distribution (Percentages)</h4>
              {totalBalls > 10 && stats.stdDev > 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <div className="w-3 h-0.5 bg-red-500"></div>
                  <span>Theoretical Normal Distribution</span>
                </div>
              )}
            </div>
            <div className="bg-[#f7f7f7] rounded-lg p-4 border-2 border-[#f2f2f2]">
              <div className="h-72 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="bin" 
                      tick={{ fontSize: 11, fill: '#64748b' }} 
                      label={{ value: "Column (0 = far left)", position: "insideBottom", offset: -5, style: { fontSize: 12, fill: '#475569' } }} 
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
                    <Bar dataKey="percentage" fill="#0ea5e9" radius={[6, 6, 0, 0]} name="Percentage">
                      <LabelList dataKey="barLabel" position="top" style={{ fontSize: 10 }} />
                    </Bar>
                    {/* Standard deviation reference lines - labels only at top to avoid overlap with bin numbers */}
                    {stdDevPositions.map((sd) => {
                      return (
                        <ReferenceLine
                          key={`${sd.value}-${sd.binIndex}`}
                          x={`${sd.binIndex}`}
                          stroke="#94a3b8"
                          strokeWidth={1}
                          strokeDasharray="2 2"
                          label={{ 
                            value: sd.label, 
                            position: "top", 
                            fontSize: 9, 
                            fill: '#64748b', 
                            fontWeight: 'bold', 
                            offset: -5 
                          }}
                        />
                      );
                    })}
                    {totalBalls > 10 && stats.stdDev > 0.1 && (
                      <Line 
                        type="monotone" 
                        dataKey="normal" 
                        stroke="#ef4444" 
                        strokeWidth={2} 
                        dot={false}
                        name="Normal Distribution"
                        isAnimationActive={false}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
