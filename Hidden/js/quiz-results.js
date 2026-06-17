/* ══════════════════════════════════════════
   PLAYRA — QUIZ RESULTS MODULE
   View Results Modal + PDF Export
   ══════════════════════════════════════════ */

import { getAvatarById } from './avatar-data.js';

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

/**
 * Derive participant analytics from quiz data.
 * Each correct answer = 10 pts.
 */
function computeAnalytics(quizData, participants) {
  const scores = quizData.scores || {};
  const totalQuestions = (quizData.questions || []).length || 1;

  const entries = participants.map(p => {
    const score = scores[p.id] || 0;
    const correct = Math.round(score / 10);
    const wrong = totalQuestions - correct;
    const accuracy = Math.round((correct / totalQuestions) * 100);
    return { id: p.id, name: p.name, score, correct, wrong, accuracy, avatarId: p.avatarId || null };
  });

  // Sort descending by score, then alphabetically
  entries.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Assign ranks (handle ties)
  let rank = 1;
  entries.forEach((e, i) => {
    if (i > 0 && e.score < entries[i - 1].score) rank = i + 1;
    e.rank = rank;
  });

  return { entries, totalQuestions };
}

/**
 * Format a Firestore timestamp or JS Date into a readable string.
 */
function formatTimestamp(ts) {
  let date;
  if (ts && ts.toDate) {
    date = ts.toDate();
  } else if (ts && ts.toMillis) {
    date = new Date(ts.toMillis());
  } else if (typeof ts === 'number') {
    date = new Date(ts);
  } else {
    date = new Date();
  }
  return date.toLocaleString('en-IN', {
    dateStyle: 'long',
    timeStyle: 'short'
  });
}

// ══════════════════════════════════════════
//  VIEW RESULTS MODAL
// ══════════════════════════════════════════

export function openResultsModal(quizData, participants) {
  const modal = document.getElementById('results-modal');
  if (!modal) return;

  const { entries, totalQuestions } = computeAnalytics(quizData, participants);

  // ── Header ──
  const titleEl = modal.querySelector('.results-modal-title');
  if (titleEl) titleEl.textContent = quizData.title || 'Quiz Results';

  // ── Summary Stats ──
  const statsEl = modal.querySelector('.results-summary-stats');
  if (statsEl) {
    const totalPlayers = entries.length;
    const avgScore = totalPlayers > 0 ? Math.round(entries.reduce((s, e) => s + e.score, 0) / totalPlayers) : 0;
    const highestScore = totalPlayers > 0 ? entries[0].score : 0;
    const avgAccuracy = totalPlayers > 0 ? Math.round(entries.reduce((s, e) => s + e.accuracy, 0) / totalPlayers) : 0;

    statsEl.innerHTML = `
      <div class="results-stat-card">
        <span class="results-stat-icon">👥</span>
        <span class="results-stat-value">${totalPlayers}</span>
        <span class="results-stat-label">Participants</span>
      </div>
      <div class="results-stat-card">
        <span class="results-stat-icon">📝</span>
        <span class="results-stat-value">${totalQuestions}</span>
        <span class="results-stat-label">Questions</span>
      </div>
      <div class="results-stat-card">
        <span class="results-stat-icon">⭐</span>
        <span class="results-stat-value">${avgScore} pts</span>
        <span class="results-stat-label">Avg Score</span>
      </div>
      <div class="results-stat-card">
        <span class="results-stat-icon">🏆</span>
        <span class="results-stat-value">${highestScore} pts</span>
        <span class="results-stat-label">Highest</span>
      </div>
      <div class="results-stat-card">
        <span class="results-stat-icon">🎯</span>
        <span class="results-stat-value">${avgAccuracy}%</span>
        <span class="results-stat-label">Avg Accuracy</span>
      </div>`;
  }

  // ── Winner Highlight ──
  const winnerEl = modal.querySelector('.results-winner-highlight');
  if (winnerEl) {
    if (entries.length > 0) {
      const winner = entries[0];
      winnerEl.style.display = '';
      const winnerAvatar = winner.avatarId ? getAvatarById(winner.avatarId) : null;
      const winnerAvatarHTML = winnerAvatar
        ? `<img class="participant-avatar-img participant-avatar-img--lg results-winner-avatar" src="${winnerAvatar.src}" alt="${winnerAvatar.label}" />`
        : `<div class="results-winner-badge">🥇</div>`;
      winnerEl.innerHTML = `
        ${winnerAvatarHTML}
        <div class="results-winner-info">
          <span class="results-winner-label">Winner</span>
          <span class="results-winner-name">${winner.name}</span>
          <span class="results-winner-score">${winner.score} pts · ${winner.accuracy}% accuracy</span>
        </div>`;
    } else {
      winnerEl.style.display = 'none';
    }
  }

  // ── Table ──
  const tbody = modal.querySelector('.results-table tbody');
  if (tbody) {
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    tbody.innerHTML = entries.map(e => {
      const medal = medals[e.rank] || `#${e.rank}`;
      const accuracyClass = e.accuracy >= 80 ? 'accuracy--high' : e.accuracy >= 50 ? 'accuracy--mid' : 'accuracy--low';
      const avatar = e.avatarId ? getAvatarById(e.avatarId) : null;
      const avatarHTML = avatar
        ? `<img class="participant-avatar-img participant-avatar-img--sm" src="${avatar.src}" alt="${avatar.label}" />`
        : '';
      return `<tr>
        <td class="results-rank-cell">${medal}</td>
        <td class="results-name-cell">${avatarHTML}<span>${e.name}</span></td>
        <td>${e.score}</td>
        <td class="results-correct-cell">${e.correct}</td>
        <td class="results-wrong-cell">${e.wrong}</td>
        <td class="${accuracyClass}">${e.accuracy}%</td>
      </tr>`;
    }).join('');
  }

  // ── Completion Timestamp ──
  const tsEl = modal.querySelector('.results-modal-timestamp');
  if (tsEl) {
    tsEl.textContent = `Completed: ${formatTimestamp(quizData.endedAt)}`;
  }

  // Show with animation
  modal.classList.add('results-modal--visible');
  document.body.style.overflow = 'hidden';
}

export function closeResultsModal() {
  const modal = document.getElementById('results-modal');
  if (!modal) return;
  modal.classList.remove('results-modal--visible');
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════
//  PDF DOWNLOAD
// ══════════════════════════════════════════

/**
 * Playra logo as base64 — small "P" badge for the PDF header.
 * We draw it programmatically instead to avoid large base64 strings.
 */
function drawPlayraLogo(doc, x, y) {
  // Rounded rect badge
  doc.setFillColor(99, 91, 255); // #635bff
  doc.roundedRect(x, y, 28, 28, 4, 4, 'F');
  // "P" letter
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('P', x + 9, y + 20);
}

export async function downloadResultsPDF(quizData, participants) {
  // Dynamic import of jsPDF — only loaded when user clicks Download PDF
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('https://esm.sh/jspdf@2.5.2'),
    import('https://esm.sh/jspdf-autotable@3.8.4')
  ]);

  const { entries, totalQuestions } = computeAnalytics(quizData, participants);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  // ════════ HEADER ════════
  drawPlayraLogo(doc, margin, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(26, 26, 46); // --color-text
  doc.text('Playra', margin + 34, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(107, 112, 148); // --color-text-secondary
  doc.text('Quiz Results Report', margin + 34, y + 20);

  // Date in top right
  const completionDate = formatTimestamp(quizData.endedAt);
  doc.setFontSize(9);
  doc.setTextColor(107, 112, 148);
  doc.text(completionDate, pageWidth - margin, y + 12, { align: 'right' });

  y += 36;

  // Divider line
  doc.setDrawColor(228, 231, 241); // --color-border
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ════════ QUIZ TITLE ════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(26, 26, 46);
  doc.text(quizData.title || 'Untitled Quiz', margin, y);
  y += 10;

  // ════════ SUMMARY CARDS ════════
  const totalPlayers = entries.length;
  const avgScore = totalPlayers > 0 ? Math.round(entries.reduce((s, e) => s + e.score, 0) / totalPlayers) : 0;
  const avgAccuracy = totalPlayers > 0 ? Math.round(entries.reduce((s, e) => s + e.accuracy, 0) / totalPlayers) : 0;

  // Summary row background
  const cardW = (pageWidth - margin * 2 - 12) / 4;
  const summaryItems = [
    { label: 'Participants', value: `${totalPlayers}`, icon: '👥' },
    { label: 'Questions', value: `${totalQuestions}`, icon: '📝' },
    { label: 'Avg Score', value: `${avgScore} pts`, icon: '⭐' },
    { label: 'Avg Accuracy', value: `${avgAccuracy}%`, icon: '🎯' }
  ];

  summaryItems.forEach((item, i) => {
    const cx = margin + i * (cardW + 4);
    // Card background
    doc.setFillColor(248, 249, 252); // --color-bg
    doc.roundedRect(cx, y, cardW, 22, 3, 3, 'F');
    // Border
    doc.setDrawColor(228, 231, 241);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, 22, 3, 3, 'S');
    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(99, 91, 255); // primary
    doc.text(item.value, cx + cardW / 2, y + 10, { align: 'center' });
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 112, 148);
    doc.text(item.label, cx + cardW / 2, y + 18, { align: 'center' });
  });

  y += 30;

  // ════════ WINNER HIGHLIGHT ════════
  if (entries.length > 0) {
    const winner = entries[0];
    const highlightW = pageWidth - margin * 2;

    // Main banner background
    doc.setFillColor(99, 91, 255); // primary purple
    doc.roundedRect(margin, y, highlightW, 26, 4, 4, 'F');

    // Accent left stripe
    doc.setFillColor(0, 212, 170); // teal accent
    doc.roundedRect(margin, y, 6, 26, 4, 0, 'F');
    doc.rect(margin + 3, y, 3, 26, 'F'); // square off the right side of rounded rect

    // ── Left: Playra logo (mini) ──
    const logoX = margin + 10;
    const logoY = y + 4;
    doc.setFillColor(255, 255, 255, 0.25); // semi-transparent white box
    doc.setFillColor(140, 130, 255);       // lighter purple for mini logo bg
    doc.roundedRect(logoX, logoY, 16, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text('P', logoX + 4.5, logoY + 11);

    // ── Center: "Winner: <name>" ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    const winnerLabel = `Winner: ${winner.name}`;
    doc.text(winnerLabel, pageWidth / 2, y + 10, { align: 'center' });

    // ── Score & accuracy below name ──
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(220, 215, 255); // light lavender
    doc.text(`${winner.score} pts  |  ${winner.accuracy}% accuracy`, pageWidth / 2, y + 20, { align: 'center' });

    // ── Right: #1 rank badge ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('#1', pageWidth - margin - 10, y + 15, { align: 'right' });

    y += 34;
  }

  // ════════ LEADERBOARD TABLE ════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(26, 26, 46);
  doc.text('Leaderboard', margin, y);
  y += 6;

  const tableBody = entries.map(e => {
    const avatarLabel = e.avatarId ? (getAvatarById(e.avatarId)?.label || '') : '';
    const displayName = avatarLabel ? `${e.name} (${avatarLabel})` : e.name;
    return [
      `#${e.rank}`,
      displayName,
      `${e.score} pts`,
      `${e.correct}`,
      `${e.wrong}`,
      `${e.accuracy}%`
    ];
  });

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Rank', 'Name', 'Score', 'Correct', 'Wrong', 'Accuracy']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [99, 91, 255],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 10,
      halign: 'center',
      cellPadding: 4
    },
    bodyStyles: {
      fontSize: 9.5,
      textColor: [26, 26, 46],
      cellPadding: 3.5,
      halign: 'center'
    },
    columnStyles: {
      0: { cellWidth: 18, fontStyle: 'bold' },
      1: { halign: 'left', cellWidth: 'auto' },
      2: { cellWidth: 26 },
      3: { cellWidth: 22, textColor: [16, 185, 129] },
      4: { cellWidth: 22, textColor: [239, 68, 68] },
      5: { cellWidth: 26 }
    },
    alternateRowStyles: {
      fillColor: [248, 249, 252]
    },
    styles: {
      lineColor: [228, 231, 241],
      lineWidth: 0.3
    },
    didParseCell: function (data) {
      // Highlight top 3 rows
      if (data.section === 'body' && data.row.index < 3) {
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  // ════════ FOOTER ════════
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();

    // Footer line
    doc.setDrawColor(228, 231, 241);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);

    // Footer text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(107, 112, 148);
    doc.text('Generated by Playra - playra.in', margin, pageHeight - 10);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
  }

  // ════════ DOWNLOAD ════════
  const safeTitle = (quizData.title || 'quiz').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  doc.save(`${safeTitle}-results.pdf`);
}
