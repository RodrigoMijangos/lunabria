/**
 * DrawingCanvasView.js
 * Renders smooth quadratic Bezier curves, dynamic pressure lines, and highlighter multiplier strokes.
 */
const DrawingCanvasView = {
  createDrawingCanvas(pageNumber, width, height, outputScale) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-drawing-canvas';
    canvas.dataset.page = pageNumber;
    canvas.width = Math.floor(width * outputScale);
    canvas.height = Math.floor(height * outputScale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return canvas;
  },

  renderStrokes(canvas, strokesList, currentStroke, activeDrawPage, pageNumber, effScale, outScale, pressureSensitivity = 'normal') {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const strokes = [...strokesList];
    if (currentStroke && activeDrawPage === pageNumber && currentStroke.points?.length) {
      strokes.push(currentStroke);
    }
    if (!strokes.length) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    for (const stroke of strokes) {
      const pts = stroke.points;
      if (!pts || pts.length === 0) continue;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.38;
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = (stroke.width || 4) * 2.8 * effScale * outScale;
      } else {
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        const avgPressure = pts.reduce((sum, p) => sum + (p.p || 0.5), 0) / pts.length;
        let pressureFactor = 0.35 + avgPressure * 1.3;
        if (pressureSensitivity === 'soft') {
          pressureFactor = 0.5 + avgPressure * 1.5;
        } else if (pressureSensitivity === 'firm') {
          pressureFactor = 0.25 + avgPressure * 1.0;
        }
        ctx.lineWidth = (stroke.width || 4) * pressureFactor * effScale * outScale;
      }

      if (pts.length === 1) {
        const x = pts[0].x * canvasWidth;
        const y = pts[0].y * canvasHeight;
        const w = (stroke.width || 4) * (stroke.tool === 'highlighter' ? 2.8 : (0.35 + (pts[0].p || 0.5) * 1.3)) * effScale * outScale;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, w / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      // Smooth continuous Quadratic Bezier curve through midpoints
      ctx.beginPath();
      const p0 = pts[0];
      ctx.moveTo(p0.x * canvasWidth, p0.y * canvasHeight);

      if (pts.length === 2) {
        ctx.lineTo(pts[1].x * canvasWidth, pts[1].y * canvasHeight);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2 * canvasWidth;
          const yc = (pts[i].y + pts[i + 1].y) / 2 * canvasHeight;
          ctx.quadraticCurveTo(pts[i].x * canvasWidth, pts[i].y * canvasHeight, xc, yc);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x * canvasWidth, last.y * canvasHeight);
      }

      ctx.stroke();
      ctx.restore();
    }
  }
};

window.DrawingCanvasView = DrawingCanvasView;
